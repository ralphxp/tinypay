-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dva_account_number" TEXT,
ADD COLUMN     "paystack_customer_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_paystack_customer_code_key" ON "users"("paystack_customer_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_dva_account_number_key" ON "users"("dva_account_number");
