-- Which side of the business (Lashes or Hair & Wigs) a receptionist or manager looks after. NULL = the whole branch.
ALTER TABLE "Staff" ADD COLUMN "department" TEXT;
