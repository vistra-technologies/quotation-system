-- CreateIndex
CREATE UNIQUE INDEX "Partition_organizationId_partitionNumber_key" ON "Partition"("organizationId", "partitionNumber");
