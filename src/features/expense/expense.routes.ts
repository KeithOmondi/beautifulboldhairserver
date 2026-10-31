import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/role.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { dayEnd, dayStart, monthBounds, todayString } from "../../utils/time";
import { requires } from "../../utils/access";

const createSchema = z.object({
  category: z.string().trim().min(2).max(40),
  amount: z.number().int().positive(),
  note: z.string().trim().max(200).optional(),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function expenseRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);
  const managers = { preHandler: [authorize("OWNER", "MANAGER")] };

  app.get("/", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const { month } = req.query as { month?: string };
    const { first, last } = monthBounds(month ? `${month}-01` : todayString());
    const rows = await prisma.expense.findMany({
      where: { branchId: req.user.branchId, spentAt: { gte: dayStart(first), lt: dayEnd(last) } },
      orderBy: { spentAt: "desc" },
    });
    return reply.send(rows);
  });

  app.post("/", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const data = createSchema.parse(req.body);
    const expense = await prisma.expense.create({
      data: {
        branchId: req.user.branchId,
        category: data.category,
        amount: data.amount,
        note: data.note ?? null,
        recordedBy: req.user.sub,
        ...(data.spentOn ? { spentAt: new Date(`${data.spentOn}T12:00:00+03:00`) } : {}),
      },
    });
    return reply.status(201).send(expense);
  });

  // Deleting an expense removes a record of money going out, so it is a "correct the books" action.
  app.delete("/:id", { preHandler: [authorize("OWNER", "MANAGER"), requires("refunds")] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const found = await prisma.expense.findFirst({ where: { id, branchId: req.user.branchId } });
    if (!found) throw new AppError(404, "Expense not found", "NOT_FOUND");
    await prisma.expense.delete({ where: { id } });
    return reply.send({ message: "Expense deleted" });
  });
}
