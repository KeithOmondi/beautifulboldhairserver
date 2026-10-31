-- Put existing services into the two sides of the business by what they are called.
UPDATE "Service" SET "category" = 'Lashes' WHERE ("category" IS NULL OR "category" ILIKE '%lash%') AND "name" ILIKE '%lash%';
UPDATE "Service" SET "category" = 'Hair & Wigs'
 WHERE "category" IS NULL AND ("isWigService" OR "name" ~* '(wig|hair|braid|weave|silk|press|style|styling)');
