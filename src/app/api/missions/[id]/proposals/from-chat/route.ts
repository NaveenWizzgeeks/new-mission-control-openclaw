import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { insertProposedSubtasks } from '@/lib/missions/autoPropose';
import type { GeneratedSubtaskShape } from '@/lib/missions/furyPlanner';

export const dynamic = 'force-dynamic';

/**
 * POST /api/missions/[id]/proposals/from-chat
 *
 * Approve subtask specs that came out of an Ask-Fury conversation. The Ask
 * Fury tab parses Fury's reply for JSON spec blocks and shows them as cards
 * with an "Add to Proposed" action; that action calls this endpoint with the
 * parsed specs. We re-use insertProposedSubtasks so the rows land in the
 * existing planner_proposed flow — same convoy counter recompute, same
 * dedupe-by-title, same broadcast that auto-propose uses. From there the
 * Proposed column already gives the operator approve/reject/restore.
 */
const SubtaskSpecSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  agent_role: z.enum(['planner', 'builder', 'tester', 'reviewer', 'general']).optional(),
  priority: z.number().optional(),
  dependencies: z.array(z.number()).optional(),
  files_to_modify: z.array(z.string()).optional(),
  needs_planning: z.boolean().optional(),
});

const BodySchema = z.object({
  subtasks: z.array(SubtaskSpecSchema).min(1).max(20),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: missionId } = await params;
  try {
    const body = await request.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid spec list', code: 'validation_failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = insertProposedSubtasks(
      missionId,
      parsed.data.subtasks as GeneratedSubtaskShape[],
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error('[Proposals from-chat] failed:', err);
    return NextResponse.json(
      { error: 'Failed to add proposed subtasks', code: 'internal_error' },
      { status: 500 },
    );
  }
}
