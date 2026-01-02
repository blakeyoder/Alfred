import "dotenv/config";
import { sql, closeConnection } from "../src/db/client.js";
import { createUser } from "../src/db/queries/users.js";
import { createCouple, addCoupleMembers } from "../src/db/queries/couples.js";
import { createThread, addParticipant } from "../src/db/queries/threads.js";

async function seedDemo() {
  console.log("Seeding demo data...\n");

  // Check if demo data already exists
  const existingUsers = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM users WHERE email IN ('blake@example.com', 'partner@example.com')
  `;

  if (existingUsers[0].count > 0) {
    console.log("Demo data already exists. Skipping seed.");
    await closeConnection();
    return;
  }

  // Create two demo users
  console.log("Creating users...");
  const blake = await createUser("blake@example.com", "Blake");
  console.log(`  Created: ${blake.name} (${blake.email})`);

  const partner = await createUser("partner@example.com", "Partner");
  console.log(`  Created: ${partner.name} (${partner.email})`);

  // Create a couple
  console.log("\nCreating couple...");
  const couple = await createCouple("Blake & Partner");
  await addCoupleMembers(couple.id, blake.id, partner.id);
  console.log(`  Created: ${couple.name}`);

  // Create shared thread
  console.log("\nCreating threads...");
  const sharedThread = await createThread(couple.id, "shared", blake.id);
  await addParticipant(sharedThread.id, blake.id);
  await addParticipant(sharedThread.id, partner.id);
  console.log(`  Created: shared thread (${sharedThread.id})`);

  // Create DM threads for each user
  const blakeDm = await createThread(couple.id, "dm", blake.id, blake.id);
  await addParticipant(blakeDm.id, blake.id);
  console.log(`  Created: Blake's DM thread (${blakeDm.id})`);

  const partnerDm = await createThread(couple.id, "dm", partner.id, partner.id);
  await addParticipant(partnerDm.id, partner.id);
  console.log(`  Created: Partner's DM thread (${partnerDm.id})`);

  console.log("\nDemo data seeded successfully!");
  console.log("\nUser IDs:");
  console.log(`  Blake: ${blake.id}`);
  console.log(`  Partner: ${partner.id}`);
  console.log(`\nCouple ID: ${couple.id}`);
  console.log(`\nThread IDs:`);
  console.log(`  Shared: ${sharedThread.id}`);
  console.log(`  Blake DM: ${blakeDm.id}`);
  console.log(`  Partner DM: ${partnerDm.id}`);

  await closeConnection();
}

seedDemo().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
