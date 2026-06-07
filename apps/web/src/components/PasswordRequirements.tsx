import { CheckCircle2, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

interface PasswordRequirementsProps {
  id: string;
  password: string;
}

export function PasswordRequirements({ id, password }: PasswordRequirementsProps) {
  const requirements = [
    {
      label: "At least 8 characters",
      satisfied: password.length >= 8,
    },
    {
      label: "At least one uppercase letter",
      satisfied: /[A-Z]/.test(password),
    },
    {
      label: "At least one lowercase letter",
      satisfied: /[a-z]/.test(password),
    },
    {
      label: "At least one number",
      satisfied: /[0-9]/.test(password),
    },
    {
      label: "At least one special character",
      satisfied: /[^A-Za-z0-9]/.test(password),
    },
  ];

  return (
    <ul id={id} className="space-y-1.5 text-xs" aria-live="polite">
      {requirements.map((requirement) => {
        const Icon = requirement.satisfied ? CheckCircle2 : XCircle;
        return (
          <li
            key={requirement.label}
            className={cn(
              "flex items-center gap-2",
              requirement.satisfied ? "text-emerald-700" : "text-destructive",
            )}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{requirement.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
