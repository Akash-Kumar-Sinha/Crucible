import * as React from "react";
import { Notch } from "@/components/ui/notch";
import { useRouter } from "next/navigation";

export const NotchSection = () => {
  const router = useRouter();
  return (
    <Notch
      position="bottom"
      align="center"
      offset={18}
      showDividers
      accentColor="var(--primary, #3b82f6)"
      items={[
        {
          id: "navigate",
          label: "Features",
          defaultValue: "features",
          options: [
            { id: "features", label: "Features" },
            { id: "about", label: "About" },
          ],
          onChange: (optionId) => {
            document
              .getElementById(optionId)
              ?.scrollIntoView({ behavior: "smooth" });
          },
        },
        {
          id: "go",
          label: "Go",
          defaultValue: "session",
          options: [
            { id: "session", label: "Session" },
            { id: "metrics", label: "Metrics" },
          ],
          onChange: (optionId) => {
            if (optionId === "session") router.push("/workspace/session");
            if (optionId === "metrics") router.push("/metrics");
          },
        },
      ]}
    />
  );
};
