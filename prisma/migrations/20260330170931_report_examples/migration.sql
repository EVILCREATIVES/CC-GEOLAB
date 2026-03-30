-- CreateTable
CREATE TABLE "ReportExample" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "resources" TEXT[],
    "reportText" TEXT NOT NULL,
    "kmzSummary" TEXT,
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportExample_pkey" PRIMARY KEY ("id")
);
