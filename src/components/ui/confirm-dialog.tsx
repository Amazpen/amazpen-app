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

interface ConfirmSecondaryAction {
  label: string
  onClick: () => void
}

interface ConfirmDialogOptions {
  // Override the primary (destructive) button label. Defaults to "אישור".
  confirmLabel?: string
  // Optional third button rendered between the primary action and Cancel.
  // When present the dialog shows: [confirmLabel] [secondary.label] [ביטול].
  secondary?: ConfirmSecondaryAction
}

interface ConfirmDialogState {
  open: boolean
  title: string
  description: string
  onConfirm: () => void
  confirmLabel: string
  secondary: ConfirmSecondaryAction | null
}

const initialState: ConfirmDialogState = {
  open: false,
  title: "",
  description: "",
  onConfirm: () => {},
  confirmLabel: "אישור",
  secondary: null,
}

export function useConfirmDialog() {
  const [state, setState] = React.useState<ConfirmDialogState>(initialState)

  const confirm = React.useCallback(
    (description: string, onConfirm: () => void, title = "אישור", options?: ConfirmDialogOptions) => {
      setState({
        open: true,
        title,
        description,
        onConfirm,
        confirmLabel: options?.confirmLabel ?? "אישור",
        secondary: options?.secondary ?? null,
      })
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

  const handleSecondary = React.useCallback(() => {
    state.secondary?.onClick()
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
                  {state.confirmLabel}
                </AlertDialogAction>
                {state.secondary && (
                  <AlertDialogAction onClick={handleSecondary}>
                    {state.secondary.label}
                  </AlertDialogAction>
                )}
                <AlertDialogCancel onClick={handleClose}>ביטול</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )
      },
    [state, handleClose, handleConfirm, handleSecondary]
  )

  return { confirm, ConfirmDialog: ConfirmDialogComponent }
}
