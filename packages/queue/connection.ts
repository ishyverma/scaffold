import IORedis from "ioredis"
import dotenv from "dotenv"
import path from "path"

dotenv.config({
    path: path.join(__dirname, "../../.env")
})

export const connection = new IORedis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
})