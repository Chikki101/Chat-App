import Block from '../models/Block.js';

export async function blockedUserIds(userId, candidateIds) {
  const id = String(userId);
  const candidates = candidateIds && [...new Set(candidateIds.map(String))].filter((candidate) => candidate !== id);
  if (candidates && candidates.length === 0) return new Set();

  const query = candidates
    ? {
        $or: [
          { blocker: id, blocked: { $in: candidates } },
          { blocked: id, blocker: { $in: candidates } },
        ],
      }
    : { $or: [{ blocker: id }, { blocked: id }] };
  const blocks = await Block.find(query).select('blocker blocked').lean();
  return new Set(
    blocks.map((block) =>
      String(block.blocker) === id ? String(block.blocked) : String(block.blocker)
    )
  );
}

export async function usersBlocked(firstUserId, secondUserId) {
  return Boolean(
    await Block.exists({
      $or: [
        { blocker: firstUserId, blocked: secondUserId },
        { blocker: secondUserId, blocked: firstUserId },
      ],
    })
  );
}

export async function blockedUsersAmong(userIds) {
  const ids = [...new Set(userIds.map(String))];
  const blockedByUser = new Map(ids.map((id) => [id, new Set()]));
  if (ids.length < 2) return blockedByUser;

  const blocks = await Block.find({
    blocker: { $in: ids },
    blocked: { $in: ids },
  }).select('blocker blocked').lean();
  for (const block of blocks) {
    const blockerId = String(block.blocker);
    const blockedId = String(block.blocked);
    blockedByUser.get(blockerId)?.add(blockedId);
    blockedByUser.get(blockedId)?.add(blockerId);
  }
  return blockedByUser;
}
