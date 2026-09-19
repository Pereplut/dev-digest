import { SkillsLabShell } from "./_components/SkillsLabShell/SkillsLabShell";

/* Skills Lab layout: the list column persists across /skills, /skills/new and
   /skills/:id, so switching skills only swaps the right-hand pane. */
export default function SkillsLayout({ children }: { children: React.ReactNode }) {
  return <SkillsLabShell>{children}</SkillsLabShell>;
}
