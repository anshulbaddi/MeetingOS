import Link from "next/link"
import { notFound } from "next/navigation"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getWorkoutById } from "@/data/workouts"

export default async function WorkoutDetailPage({
  params,
}: {
  params: Promise<{ workoutid: string }>
}) {
  const { workoutid } = await params
  const id = parseInt(workoutid, 10)

  if (isNaN(id)) notFound()

  const workout = await getWorkoutById(id)

  if (!workout) notFound()

  const durationMin =
    workout.completedAt
      ? Math.round(
          (workout.completedAt.getTime() - workout.startedAt.getTime()) / 60000,
        )
      : null

  return (
    <main className="flex flex-col gap-8 px-8 py-8 w-full max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {format(workout.startedAt, "MMMM d, yyyy")}
          </h1>
          <p className="text-sm text-muted-foreground">
            Started at {format(workout.startedAt, "h:mm a")}
            {durationMin !== null && ` · ${durationMin} min`}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back</Link>
        </Button>
      </div>

      {workout.notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{workout.notes}</p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">Exercises</h2>
          <Badge variant="outline" className="text-muted-foreground">
            {workout.workoutExercises.length}{" "}
            {workout.workoutExercises.length === 1 ? "exercise" : "exercises"}
          </Badge>
        </div>

        {workout.workoutExercises.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              No exercises logged for this workout.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {workout.workoutExercises.map((exercise) => (
              <Card key={exercise.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{exercise.name}</CardTitle>
                  <CardDescription>
                    {exercise.sets.length}{" "}
                    {exercise.sets.length === 1 ? "set" : "sets"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-1.5">
                    {exercise.sets.map((set) => (
                      <div
                        key={set.id}
                        className="flex items-center gap-4 text-sm"
                      >
                        <span className="text-muted-foreground w-12">
                          Set {set.setNumber}
                        </span>
                        <span>
                          {set.reps} reps @ {set.weight} {set.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
