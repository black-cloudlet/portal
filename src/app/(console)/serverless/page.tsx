import { redirect } from "next/navigation";

/** The Serverless landing defaults to the Functions tab. */
export default function ServerlessPage() {
  redirect("/serverless/functions");
}
