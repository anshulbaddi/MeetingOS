import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function main() {
  console.log('Dropping existing schema...');
  await sql`DROP TABLE IF EXISTS sets CASCADE`;
  await sql`DROP TABLE IF EXISTS workout_exercises CASCADE`;
  await sql`DROP TABLE IF EXISTS workouts CASCADE`;
  await sql`DROP TYPE IF EXISTS weight_unit CASCADE`;

  console.log('Applying migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Done.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
