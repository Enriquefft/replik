"use client"

import type * as LabelPrimitive from "@radix-ui/react-label"
import { Slot } from "radix-ui"
import * as React from "react"
import type { ControllerProps, FieldPath, FieldValues } from "react-hook-form"
import { Controller, FormProvider, useFormContext } from "react-hook-form"
import { Label } from "@/components/ui/label.tsx"
import { cn } from "@/lib/utils.ts"

const Form = FormProvider

interface FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  name: TName
}

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue)

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ ...props }: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  const { getFieldState, formState } = useFormContext()

  if (!fieldContext.name) {
    throw new Error("useFormField should be used within <FormField>")
  }

  const fieldState = getFieldState(fieldContext.name, formState)

  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

interface FormItemContextValue {
  id: string
}

const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue)

function FormItem({
  className,
  ref,
  ...props
}: React.ComponentProps<"div"> & { ref?: React.Ref<HTMLDivElement> }) {
  const id = React.useId()

  return (
    <FormItemContext.Provider value={{ id }}>
      <div ref={ref} data-slot="form-item" className={cn("grid gap-2", className)} {...props} />
    </FormItemContext.Provider>
  )
}

function FormLabel({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & {
  ref?: React.Ref<React.ComponentRef<typeof LabelPrimitive.Root>>
}) {
  const { error, formItemId } = useFormField()

  return (
    <Label
      ref={ref}
      data-slot="form-label"
      data-error={!!error}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  )
}

function FormControl({
  ref,
  ...props
}: React.ComponentProps<typeof Slot.Root> & {
  ref?: React.Ref<React.ComponentRef<typeof Slot.Root>>
}) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()

  return (
    <Slot.Root
      ref={ref}
      id={formItemId}
      aria-describedby={!error ? formDescriptionId : `${formDescriptionId} ${formMessageId}`}
      aria-invalid={!!error}
      {...props}
    />
  )
}

function FormDescription({
  className,
  ref,
  ...props
}: React.ComponentProps<"p"> & { ref?: React.Ref<HTMLParagraphElement> }) {
  const { formDescriptionId } = useFormField()

  return (
    <p
      ref={ref}
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function FormMessage({
  className,
  children,
  ref,
  ...props
}: React.ComponentProps<"p"> & { ref?: React.Ref<HTMLParagraphElement> }) {
  const { error, formMessageId } = useFormField()
  const body = error ? (error.message ?? "") : children

  if (!body) {
    return null
  }

  return (
    <p
      ref={ref}
      data-slot="form-message"
      id={formMessageId}
      className={cn("text-destructive text-sm font-medium", className)}
      {...props}
    >
      {body}
    </p>
  )
}

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
}
