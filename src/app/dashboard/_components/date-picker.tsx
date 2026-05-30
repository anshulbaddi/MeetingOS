"use client"

import { useEffect } from "react"
import { format, parseISO } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function DatePicker({ dateStr }: { dateStr: string }) {
  const router = useRouter()
  const selectedDate = parseISO(dateStr)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has("tz")) {
      const tz = new Date().getTimezoneOffset()
      params.set("tz", String(tz))
      if (!params.has("date")) {
        const nowLocalMs = Date.now() - tz * 60 * 1000
        params.set("date", new Date(nowLocalMs).toISOString().slice(0, 10))
      }
      router.replace(`/dashboard?${params.toString()}`)
    }
  }, [router])

  function handleSelect(date: Date | undefined) {
    if (!date) return
    const params = new URLSearchParams(window.location.search)
    params.set("date", format(date, "yyyy-MM-dd"))
    params.set("tz", String(new Date().getTimezoneOffset()))
    router.push(`/dashboard?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium">Date</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-[240px] justify-start gap-2 font-normal">
            <CalendarIcon className="size-4 text-muted-foreground" />
            {format(selectedDate, "MMMM d, yyyy")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
