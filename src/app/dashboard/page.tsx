import Link from "next/link"
import { format, parseISO } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DatePicker } from "./_components/date-picker"
import { getWorkoutsForDate } from "@/data/workouts"

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { date, tz } = await searchParams
  const tzOffset = typeof tz === "string" ? parseInt(tz, 10) : 0
  const dateStr = typeof date === "string"
    ? date
    : new Date(Date.now() - tzOffset * 60 * 1000).toISOString().slice(0, 10)
  const workouts = await getWorkoutsForDate(dateStr, tzOffset)
  const displayDate = parseISO(dateStr)

  return (
    <main className="flex flex-col gap-8 px-8 py-8 w-full">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">View your workouts by date.</p>
        </div>
        <Button asChild>
          <Link href={`/dashboard/workout/new?date=${dateStr}`}>Log Workout</Link>
        </Button>
      </div>

      <DatePicker dateStr={dateStr} />

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">
            Workouts for {format(displayDate, "MMMM d, yyyy")}
          </h2>
          <Badge variant="outline" className="text-muted-foreground">
            {workouts.length} {workouts.length === 1 ? "session" : "sessions"}
          </Badge>
        </div>

        {workouts.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              No workouts logged for this date.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {workouts.map((workout) => {
              const durationMin =
                workout.completedAt
                  ? Math.round(
                      (workout.completedAt.getTime() - workout.startedAt.getTime()) / 60000,
                    )
                  : null

              return (
                <Link key={workout.id} href={`/dashboard/workout/${workout.id}`} className="block">
                <Card className="transition-colors hover:bg-muted/50 cursor-pointer">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <CardTitle className="text-base">
                          {format(workout.startedAt, "h:mm a")}
                        </CardTitle>
                        {durationMin !== null && (
                          <CardDescription>{durationMin} min</CardDescription>
                        )}
                        {workout.notes && (
                          <CardDescription>{workout.notes}</CardDescription>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {workout.workoutExercises.length}{" "}
                          {workout.workoutExercises.length === 1 ? "exercise" : "exercises"}
                        </Badge>
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/dashboard/workout/${workout.id}`}>Edit</Link>
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  {workout.workoutExercises.length > 0 && (
                    <CardContent>
                      <div className="flex flex-col gap-3">
                        {workout.workoutExercises.map((exercise) => (
                          <div key={exercise.id} className="flex flex-col gap-1">
                            <span className="text-sm font-medium">{exercise.name}</span>
                            <div className="flex flex-col gap-0.5">
                              {exercise.sets.map((set) => (
                                <span
                                  key={set.id}
                                  className="text-sm text-muted-foreground"
                                >
                                  Set {set.setNumber} — {set.reps} reps @ {set.weight}{" "}
                                  {set.unit}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
