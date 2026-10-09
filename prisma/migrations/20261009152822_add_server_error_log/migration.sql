-- CreateTable
CREATE TABLE "server_error_logs" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "context" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "server_error_logs_created_at_idx" ON "server_error_logs"("created_at");
