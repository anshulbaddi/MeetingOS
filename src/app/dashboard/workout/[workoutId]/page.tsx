import { notFound } from "next/navigation";
import { getWorkoutById } from "@/data/workouts";
import EditWorkoutForm, { type WorkoutForEdit } from "./edit-form";

export default async function EditWorkoutPage({
  params,
}: {
  params: Promise<{ workoutId: string }>;
}) {
  const { workoutId } = await params;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(workoutId)) notFound();

  const workout = await getWorkoutById(workoutId);
  if (!workout) notFound();

  const workoutForEdit: WorkoutForEdit = {
    id: workout.id, // uuid string
    startedAt: workout.startedAt.toISOString(),
    notes: workout.notes ?? null,
    exercises: workout.workoutExercises.map((ex) => ({
      name: ex.name,
      sets: ex.sets.map((s) => ({
        reps: s.reps,
        weight: s.weight,
        unit: s.unit,
      })),
    })),
  };

  return (
    <main className="flex flex-col gap-8 px-8 py-8 w-full max-w-2xl">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Edit Workout</h1>
        <p className="text-sm text-muted-foreground">
          Update your workout details, exercises, and sets.
        </p>
      </div>
      <EditWorkoutForm workout={workoutForEdit} />
    </main>
  );
}
