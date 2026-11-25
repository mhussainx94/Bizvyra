import { notFound, parseParams } from "@/core/http";
import { SlugParamsSchema, type GetReportResponse } from "@/lib/types";
import { mockGetReport } from "@/mocks";

export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const params = parseParams(await ctx.params, SlugParamsSchema);
  if (!params.ok) return params.response;

  const report = mockGetReport(params.data.slug);
  if (!report) return notFound("Report not found");
  const body: GetReportResponse = { report };
  return Response.json(body);
}
