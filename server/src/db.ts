import { PrismaClient } from '@prisma/client'

/** Single shared Prisma client for the whole server process. */
export const prisma = new PrismaClient()
