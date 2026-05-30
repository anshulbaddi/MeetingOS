import { db } from "@/db";
import { workouts, workoutExercises, sets } from "@/db/schema";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

export type CreateWorkoutInput = {
  startedAt: Date;
  notes?: string;
  exercises: {
    name: string;
    sets: { reps: number; weight: number; unit: "lbs" | "kg" }[];
  }[];
};

export async function createWorkout(input: CreateWorkoutInput) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const [workout] = await db
    .insert(workouts)
    .values({ userId, startedAt: input.startedAt, notes: input.notes ?? null })
    .returning();

  for (let i = 0; i < input.exercises.length; i++) {
    const ex = input.exercises[i];
    const [exercise] = await db
      .insert(workoutExercises)
      .values({ workoutId: workout.id, name: ex.name, orderIndex: i })
      .returning();

    for (let j = 0; j < ex.sets.length; j++) {
      const s = ex.sets[j];
      await db.insert(sets).values({
        workoutExerciseId: exercise.id,
        setNumber: j + 1,
        reps: s.reps,
        weight: s.weight,
        unit: s.unit,
      });
    }
  }

  return workout;
}

export async function getWorkoutById(workoutId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  return db.query.workouts.findFirst({
    where: and(eq(workouts.id, workoutId), eq(workouts.userId, userId)),
    with: {
      workoutExercises: {
        orderBy: (we, { asc }) => asc(we.orderIndex),
        with: {
          sets: {
            orderBy: (s, { asc }) => asc(s.setNumber),
          },
        },
      },
    },
  });
}

export type UpdateWorkoutInput = {
  startedAt: Date;
  notes?: string;
  exercises: {
    name: string;
    sets: { reps: number; weight: number; unit: "lbs" | "kg" }[];
  }[];
};

export async function updateWorkout(workoutId: string, input: UpdateWorkoutInput) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const existing = await db.query.workouts.findFirst({
    where: and(eq(workouts.id, workoutId), eq(workouts.userId, userId)),
  });
  if (!existing) throw new Error("Not found");

  await db
    .update(workouts)
    .set({ startedAt: input.startedAt, notes: input.notes ?? null })
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)));

  await db.delete(workoutExercises).where(eq(workoutExercises.workoutId, workoutId));

  for (let i = 0; i < input.exercises.length; i++) {
    const ex = input.exercises[i];
    const [exercise] = await db
      .insert(workoutExercises)
      .values({ workoutId, name: ex.name, orderIndex: i })
      .returning();

    for (let j = 0; j < ex.sets.length; j++) {
      const s = ex.sets[j];
      await db.insert(sets).values({
        workoutExerciseId: exercise.id,
        setNumber: j + 1,
        reps: s.reps,
        weight: s.weight,
        unit: s.unit,
      });
    }
  }
}

export async function getWorkoutsForDate(dateStr: string, tzOffset: number = 0) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  // tzOffset = getTimezoneOffset() (positive = west of UTC, e.g. 420 for UTC-7)
  // Shift UTC midnight by tzOffset minutes to get local midnight in UTC
  const startMs = Date.parse(`${dateStr}T00:00:00Z`) + tzOffset * 60 * 1000;
  const start = new Date(startMs);
  const end = new Date(startMs + 24 * 60 * 60 * 1000);

  return db.query.workouts.findMany({
    where: and(
      eq(workouts.userId, userId),
      gte(workouts.startedAt, start),
      lt(workouts.startedAt, end),
    ),
    orderBy: asc(workouts.startedAt),
    with: {
      workoutExercises: {
        orderBy: (we, { asc }) => asc(we.orderIndex),
        with: {
          sets: {
            orderBy: (s, { asc }) => asc(s.setNumber),
          },
        },
      },
    },
  });
}
