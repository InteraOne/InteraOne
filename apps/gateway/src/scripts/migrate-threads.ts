import { connectDatabase, disconnectDatabase } from "@shared/infra/database";
import { Conversation } from "@shared/models/Conversation";
import { ThreadDomain } from "@shared/models/ThreadDomain";
import { ThreadParticipation } from "@modules/threads/participation";

async function migrate() {
  await connectDatabase();
  try {
    await Conversation.createIndexes();
    await ThreadParticipation.createIndexes();
    await ThreadDomain.createIndexes();
  } finally {
    await disconnectDatabase();
  }
}
migrate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
