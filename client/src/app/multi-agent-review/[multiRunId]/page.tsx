/* /multi-agent-review/:multiRunId — one fan-out's results (spec 0021). */
"use client";

import { useParams } from "next/navigation";
import { ResultsView } from "../_components/ResultsView";

export default function MultiAgentResultsPage() {
  const { multiRunId } = useParams<{ multiRunId: string }>();
  return <ResultsView id={multiRunId} />;
}
