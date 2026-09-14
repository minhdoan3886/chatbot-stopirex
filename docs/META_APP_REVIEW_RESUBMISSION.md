# Meta App Review resubmission — Stopirex

## Decision from the rejected submission

Submission `2291366594932560` was rejected on 27 August 2026 for the same reason
across all six permissions. Meta explicitly accepted that the described use case
was valid, but the uploaded screen recording did not show the complete experience
described in the permission notes.

This is an evidence failure, not a rejected business use case. Do not change the
permission descriptions into broader claims. Resubmit only after the recording
shows the visible Facebook Login, permission grant and each corresponding live
action below.

## Preconditions

- Product URL: `https://ubuntu-latitude-e5450.tail0d12f7.ts.net`
- Reviewer guide: `/app-review`
- Reviewer Page UI: `/pages?review=1`
- Reviewer comment UI: `/comments?review=1`
- The review Facebook user is supplied in App Review notes and can administer the
  supplied review Page.
- The customer test user can message and comment on the supplied Page/post.
- Product uses the fixed Tailscale webhook ending in `/webhooks/meta`.
- Page subscription includes `messages`, `messaging_postbacks`, `message_echoes`,
  `message_deliveries`, `message_reads`, `messaging_referrals` and `feed`.
- Use dummy contact information only. Never record passwords, access tokens, real
  phone numbers or customer records.

## Master recording — no cuts through authentication

Record the full browser window with the application UI in English. Use visible
callouts that name the permission being demonstrated.

1. Open `/app-review` and show the complete reviewer path.
2. Open `/pages?review=1` with the application credentials supplied separately in
   the submission.
3. Select **Connect with Facebook**.
4. Show the complete Facebook Login and permission grant screens. Do not skip or
   cut this part.
5. Select the supplied review Page and return to Stopirex.
6. Show the connected Page card. Point to **Credential encrypted**, **Webhook:
   messages + feed** and the Page-specific automation switch.
7. Enable automation for only the review Page.
8. From the customer test account, send `Hello, what is Stopirex used for?` in
   Messenger. Show the customer-initiated message and the reply on Facebook.
9. On the supplied review post, add `Can I get the current price?`. Show the public
   reply and the single private follow-up on Facebook.
10. Open `/comments?review=1` and show the same event, Page name, public reply and
    private reply.
11. Add `Please call me at 0900000000` as a second test comment. Show the privacy
    moderation recommendation, select **Hide comment**, verify it on Facebook,
    then select **Unhide comment**.
12. Add a genuine complaint without contact information. Show that Stopirex keeps
    it visible and responds without deleting criticism.

## Permission evidence matrix

| Permission                | Required visible evidence                                                        |
| ------------------------- | -------------------------------------------------------------------------------- |
| `pages_show_list`         | Facebook Login completes and only Pages administered by the user appear.         |
| `pages_manage_metadata`   | The selected Page is connected and shows the `messages + feed` subscription.     |
| `pages_messaging`         | A customer-initiated Messenger message receives the relevant support reply.      |
| `pages_read_user_content` | A newly posted customer comment appears in Comment operations.                   |
| `pages_read_engagement`   | The comment is visibly associated with the correct connected Page and Page post. |
| `pages_manage_engagement` | Public reply plus Hide/Unhide are performed and verified on Facebook.            |

## Upload plan

Upload one uncut master recording that covers login through the final moderation
action. For each permission field, upload either that master recording or a short
clip extracted from it that starts with a title card naming the permission and
contains the exact evidence in the matrix. Confirm every uploaded video plays in
the App Review form before resubmission; the rejected submission now displays a
playback error for its prior uploads.

## Permission notes for resubmission

Keep the existing valid explanations and append the matching review steps:

- `pages_show_list`: “See master recording steps 3–6. After the administrator
  completes Facebook Login, Stopirex lists only Pages returned for that
  administrator and requires explicit Page selection.”
- `pages_manage_metadata`: “See steps 5–7. Connecting the selected Page creates its
  webhook subscription for Messenger and feed events. The Page card displays the
  resulting subscription status.”
- `pages_messaging`: “See step 8. The test user initiates a Messenger conversation;
  Stopirex returns a relevant customer-care reply. No unsolicited message or
  broadcast is sent.”
- `pages_read_user_content`: “See steps 9–10. A new comment from the test user is
  received and displayed in Comment operations.”
- `pages_read_engagement`: “See steps 9–10. Comment operations displays the Page
  and engagement context used to associate the comment with the connected Page.”
- `pages_manage_engagement`: “See steps 9–12. Stopirex posts a public reply and the
  reviewer performs Hide/Unhide for dummy personal information. A complaint with
  no personal information remains visible.”

## Final go/no-go checklist

- The full login and permission grant are visible.
- The Page-selection result is visible.
- Every permission has one matching action and visible result.
- Facebook and Stopirex both show the Messenger/comment effects.
- All uploaded videos play after upload.
- UI and callouts are in English.
- Reviewer credentials and the exact Page/post URLs are included in private App
  Review notes, never in source code or public pages.
- No OpenAI quota is required to demonstrate Page connection and moderation. For
  the reply examples, ensure the configured LLM is available or use an existing
  deterministic, knowledge-backed reply that does not depend on an unsupported
  claim.
