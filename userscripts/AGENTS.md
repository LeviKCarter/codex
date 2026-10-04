# Reddit Quick Mute mobile script

The canonical published script is `Reddit-Quick-Mute-Mobile.user.js` in this directory. Edit this file when fixing the mobile Reddit extension. User authorization covers publishing subsequent requested fixes to the same permanent URL.

- Preserve the `levi.hbr.quick-mute.mobile` namespace and both permanent update URLs so installed copies update in place.
- Preserve PC behavior: subreddit mute, immediate local subreddit hiding, downvote-to-block, author buttons on posts/comments, and blocked-author hiding.
- Push requested changes to `main`. `.github/workflows/quick-mute-update.yml` validates syntax and automatically increases the patch version when content changes; it publishes the updated script at the existing raw URL.
- Do not manually change `@releaseHash`; the workflow maintains it. A version bump alone does not require another automatic bump.
- Verify the release workflow and public raw script before reporting an update as released. If publication fails, fix the failure or report it plainly.
- Do not distribute new ZIPs for ordinary updates. Tampermonkey obtains new versions from the permanent URL on its configured update schedule.
