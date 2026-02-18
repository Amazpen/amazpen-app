"use client"

import * as React from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface ConfirmDialogState {
  open: boolean
  title: string
  description: string
  onConfirm: () => void
}

const initialState: ConfirmDialogState = {
  open: false,
  title: "",
  description: "",
  onConfirm: () => {},
}

export function useConfirmDialog() {
  const [state, setState] = React.useState<ConfirmDialogState>(initialState)

  const confirm = React.useCallback(
    (description: string, onConfirm: () => void, title = "אישור") => {
      setState({ open: true, title, description, onConfirm })
    },
    []
  )

  const handleClose = React.useCallback(() => {
    setState(initialState)
  }, [])

  const handleConfirm = React.useCallback(() => {
    state.onConfirm()
    setState(initialState)
  }, [state])

  const ConfirmDialogComponent = React.useMemo(
    () =>
      function ConfirmDialog() {
        return (
          <AlertDialog open={state.open} onOpenChange={(open) => !open && handleClose()}>
            <AlertDialogContent dir="rtl">
              <AlertDialogHeader>
                <AlertDialogTitle>{state.title}</AlertDialogTitle>
                <AlertDialogDescription>{state.description}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex-row-reverse gap-2 sm:flex-row-reverse">
                <AlertDialogAction variant="destructive" onClick={handleConfirm}>
                  אישור
                </AlertDialogAction>
                <AlertDialogCancel onClick={handleClose}>ביטול</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )
      },
    [state, handleClose, handleConfirm]
  )

  return { confirm, ConfirmDialog: ConfirmDialogComponent }
}
