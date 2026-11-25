import { createHash, createHmac, randomBytes, randomUUID } from "crypto";
import Joi from "joi";
import { AppError } from "@shared/core/errors";
import config from "@shared/infra/config";
import { redisClient } from "@shared/infra/redis";
import { generateOTP } from "@shared/security/auth/otp";
import { enqueueRawEmail } from "@shared/queues/email.queue";
import { Contact } from "@shared/models";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const mac = (text: string) =>
  createHmac("sha256", config.jwt.secret!).update(text).digest("hex");
function address(value: unknown) {
  const { error, value: email } = Joi.string()
    .trim()
    .lowercase()
    .email({ tlds: { allow: false } })
    .max(254)
    .required()
    .validate(value);
  if (error) throw new AppError("Enter a valid email address", 400);
  return email as string;
}
export async function challenge(
  org: string,
  portalName: string,
  input: unknown,
) {
  const email = address(input);
  const key = "threads:otp:" + digest(org + "/" + email);
  if (!(await redisClient.set(key + ":cooldown", "1", { EX: 60, NX: true })))
    throw new AppError("Wait a minute before requesting another code", 429);
  const code = generateOTP();
  await redisClient
    .multi()
    .del(key)
    .hSet(key, { code: mac(key + code), attempts: "0" })
    .expire(key, 600)
    .exec();
  try {
    const sent = await enqueueRawEmail(
      email,
      `Your ${portalName.replace(/[\r\n]/g, " ")} sign-in code`,
      `<p>Your sign-in code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
      `Your sign-in code is ${code}. It expires in 10 minutes.`,
    );
    if (!sent) throw new AppError("Email delivery is unavailable", 503);
  } catch (error) {
    await redisClient.del([key, key + ":cooldown"]);
    throw error;
  }
}
export async function login(org: string, input: unknown, code: unknown) {
  const email = address(input);
  if (typeof code !== "string" || !/^\d{6}$/.test(code))
    throw new AppError("Enter the six-digit code", 400);
  const owner = digest(org + "/" + email);
  const key = "threads:otp:" + owner;
  const ok = await redisClient.eval(
    `if redis.call('exists',KEYS[1]) == 0 then return 0 end
    if redis.call('hincrby',KEYS[1],'attempts',1) > 5 then redis.call('del',KEYS[1]); return 0 end
    if redis.call('hget',KEYS[1],'code') ~= ARGV[1] then return 0 end
    redis.call('del',KEYS[1]); return 1`,
    { keys: [key], arguments: [mac(key + code)] },
  );
  if (ok !== 1) throw new AppError("Invalid or expired code", 401);
  const contact = await Contact.findOneAndUpdate(
    { organizationId: org, email },
    {
      $setOnInsert: {
        name: email.split("@")[0],
        sessionId: randomUUID(),
        source: "integration",
        acquisitionSource: "email",
      },
    },
    { upsert: true, new: true },
  );
  const token = randomBytes(32).toString("hex");
  const actor = {
    owner,
    email,
    name: contact.name,
    contactId: contact._id.toString(),
    sessionId: contact.sessionId,
  };
  await redisClient.set(
    "threads:session:" + org + ":" + digest(token),
    JSON.stringify(actor),
    { EX: 43200 },
  );
  return token;
}
export async function session(org: string, authorization?: string) {
  if (!authorization) return undefined;
  if (!/^Bearer [a-f0-9]{64}$/.test(authorization))
    throw new AppError("Please sign in again", 401);
  const key = "threads:session:" + org + ":" + digest(authorization.slice(7));
  const raw = await redisClient.get(key);
  if (!raw) throw new AppError("Please sign in again", 401);
  return {
    ...(JSON.parse(raw) as {
      owner: string;
      email: string;
      name: string;
      contactId: string;
      sessionId: string;
    }),
    key,
  };
}
