-- Visitors can like gallery photos (a simple social-proof counter).
ALTER TABLE "GalleryImage" ADD COLUMN "likeCount" INTEGER NOT NULL DEFAULT 0;
