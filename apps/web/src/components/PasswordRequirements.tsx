export function PasswordRequirements({ id }: { id: string }) {
  return (
    <p id={id} className="text-xs leading-5 text-muted-foreground">
      Use at least 8 characters with uppercase and lowercase letters, a number,
      and a special character.
    </p>
  );
}
