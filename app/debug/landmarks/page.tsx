import { notFound } from "next/navigation";
import { LandmarkDebug } from "@/components/camera/LandmarkDebug";

/** Yalnız development (SPEC 4.2). Production'da 404. */
export default function LandmarkDebugPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">/debug/landmarks</h1>
      <LandmarkDebug />
    </div>
  );
}
