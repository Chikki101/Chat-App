const ANSWERS = [
  {
    pattern: /\b(unban\w*|appeal|banned|ban|kick|moderation)\b/,
    answer:
      'The room creator can open Room management → Manage members and bans, then ban by member or user ID. The creator can unban from “Banned forever.” Sentiment moderation warns at 300 and automatically bans at 500 negative points in five days; only the creator can unban.',
  },
  {
    pattern: /\b(create|make|new)\b.*\b(room|space|channel)\b|\b(room|space|channel)\b.*\b(create|make)\b/,
    answer:
      'In the left sidebar, choose an invitation expiry, enter a name under Private rooms, and click Create. The room creator can copy or generate an invitation link in Room management.',
  },
  {
    pattern: /\b(invite|invitation|link|join|expire|expiry)\b/,
    answer:
      'Only the room creator can generate or rotate an invitation link in Room management. Choose an expiry, create the link, then share it. Anyone with a valid link can join; rotating it invalidates the previous link.',
  },
  {
    pattern: /\b(friend|friends|dm|direct message|one.to.one)\b/,
    answer:
      'Open Friends in the sidebar and search for the person’s user ID. Send a friend request; both people must accept before direct messaging is available. Incoming requests can be accepted or matched by sending a request back.',
  },
  {
    pattern: /\b(block|unfriend|remove friend)\b/,
    answer:
      'Use Block or Unfriend beside a friend in the sidebar. Blocking also removes the friendship and prevents messages and new friend requests until unblocked. Unblocking does not restore the friendship automatically.',
  },
  {
    pattern: /\b(profile|email|phone|privacy|bio)\b/,
    answer:
      'Open a profile from the sidebar or a message. Email, phone, and bio are visible only to the profile owner and accepted friends; other users can see basic public profile details.',
  },
  {
    pattern: /\b(sentiment|negative score|score|warning|500 points|300 points)\b/,
    answer:
      'Each message is classified locally for sentiment. In private rooms, negative points add up over a rolling five-day window: the member gets a private warning at 300 points and an automatic ban at 500. The creator can unban them.',
  },
];

const DEFAULT_ANSWER =
  'I can help with creating rooms, invitation links, bans and unbans, friends and direct messages, blocking, profiles, or sentiment moderation. Ask about one of those topics.';

export function answerSupportQuestion(text) {
  const question = String(text || '').toLowerCase();
  return ANSWERS.find(({ pattern }) => pattern.test(question))?.answer || DEFAULT_ANSWER;
}
