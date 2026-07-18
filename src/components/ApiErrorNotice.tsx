import { ServerlessApiError } from "@/lib/serverless";

/**
 * Render a failed Serverless API call. Shows the API's own error message and,
 * when the standard error envelope carried them, the machine-readable code and
 * the requestId a user can quote to support to trace the failure end to end.
 */
export default function ApiErrorNotice({ error }: { error: unknown }) {
  if (error instanceof ServerlessApiError) {
    return (
      <div className="notice notice--error">
        <p>{error.message}</p>
        {(error.code || error.requestId) && (
          <p className="notice__meta">
            {error.code && <span className="notice__code">{error.code}</span>}
            {error.code && error.requestId && " · "}
            {error.requestId && (
              <span>
                Request ID: <code>{error.requestId}</code>
              </span>
            )}
          </p>
        )}
      </div>
    );
  }
  return <div className="notice notice--error">Unexpected error: {(error as Error).message}</div>;
}
