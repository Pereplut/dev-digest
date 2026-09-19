import { SkillForm } from "../_components/SkillForm/SkillForm";

/* Route: /skills/new — an empty SkillForm in the detail pane. Static segment,
   so it wins over /skills/[id]. */
export default function NewSkillPage() {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
      <SkillForm />
    </div>
  );
}
