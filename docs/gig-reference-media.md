# Gig reference pictures

In the gig editor, use **Media → Reference pictures & files · after approval** to upload the pictures creators should include in their reels. Save the gig to publish the changes. Existing `Media::` uploads continue to work without a migration; public `Sample::` reel examples remain separate.

After an application is accepted, its approval panel shows the reference gallery before the next steps. Content Posting gigs explain that creators should show the pictures in their reel as described in the brief; pending and rejected Content Posting applications do not render the gallery. Other gig types use general reference-file guidance. Email Creator gigs retain file access through an active assignment. Gigs without references do not render an empty section.

The gallery fits its available column width and displays entire pictures without cropping; a single reference gets the full width. Each card shows the picture's orientation, ratio and pixel size, and a Download button (Supabase uploads download as attachments under their original name; other hosts open the original in a new tab). With several Supabase uploads, **Download all** saves them in one go.

Content Posting galleries add an **Original / In a reel** switch. The reel view places each picture in a 9:16 phone frame over a blurred copy of itself, shades the areas reel captions and buttons usually cover, and gives a fit tip (for example, landscape screenshots are small in a vertical reel, so creators should zoom in or pan across).

Admins can add an **in-reel example** to any reference picture in the gig editor (Media → each uploaded picture → *Add in-reel example*): a 9:16 screenshot or short clip showing exactly how the picture should appear in the reel. It is saved as a `Media::Reel::{"for":pictureUrl,"url":exampleUrl}` line, so it stays private like other `Media::` lines and older readers ignore it. Removing a picture also removes its example. When a gig has examples, the creator gallery opens in the **In a reel** view and shows the admin's example (labelled *Example*) instead of the automatic preview; pictures without one keep the automatic frame. A single reference is shown side by side with its guidance, the original picture and a Download button, and stacks on phones.

Pictures and videos open in a full-screen viewer with previous/next controls, a thumbnail strip, arrow keys and horizontal swipes. Tapping a picture zooms it to full size for reading small details. Content Posting pictures can also be previewed in a reel frame there, with Fit or Fill screen framing to show what a full-screen crop would cut. Escape closes the viewer and restores focus to the preview. Download/original links stay available if a preview fails. Video cards fetch only metadata for a preview frame; the clip itself loads when opened.

The normal dashboard refresh picks up approval decisions and saved gig media changes. Removing the current reference or revoking approval closes its viewer. This feature retains the existing upload bucket and URL access behavior; the approval condition controls where the gallery appears in the dashboard.

## Explaining how to use each picture

Each uploaded picture in the gig editor has a **What should creators show?** note (up to 240 characters), saved as a private `Media::Note::{"for":pictureUrl,"text":…}` line and removed with its picture.

For Content Posting gigs, creators see under a single picture (or in a collapsible **How to use these pictures** panel above several):

- **What to show** – the admin's note, highlighted. It also appears on the picture's card, in the reel view and in the full-screen viewer.
- **Ways to feature it in your reel** – three options with a one-tap action, worded for the picture's shape: *Film it on a screen* (opens it full screen, or jumps to the reel kit's recording screen when the gig has one), *Add it in your editor* (download, with zoom-and-pan advice for wide pictures) and *Talk in front of it* (green screen, with a reel-frame preview).
- **Before you post** – a four-item checklist that shows "Ready to post" when complete. Ticks are remembered in that browser only.

The guide lays out by its own width (three columns when there is room, stacked on phones).

## Reel kit (Content Posting)

For reels that show the creator wallet, turn on **Reel kit · demo wallet screen** under Media in the gig editor. Set the sample figures (approved and pending earnings with their reel counts, paid out, pending withdrawal), the on-screen caption, an optional shot list (one step per line; empty uses the default steps) and an optional example reel. **Preview recording screen** opens what creators will film. The kit is saved as a private `Media::Kit::{json}` line; figures are clamped and text trimmed when read.

Approved creators see a **Record this reel** workspace above the reference pictures:

- **Header** – what the kit contains, quick facts (take length, scenes, 9:16, caption ready), a progress ring and an **Open recording screen** button.
- **Preview** – *Finished look* (the admin's example reel, or an automatic phone-filming-a-laptop preview with the caption and reel UI) or *Recording screen* (the live screen). Under it, a **take timeline** follows the embedded screen live: it announces each take start (a same-origin `postMessage` tagged `REEL_KIT_MESSAGE`), so the playhead and the current scene move with it. Only one live screen is embedded at a time.
- **Four steps**, one at a time, with a stepper, Back and **Mark done & continue**: *Set up* (laptop + phone camera or phone only, what you'll need, setup instructions), *Open screen* (open, copy or send the link; keyboard or touch controls), *Shoot* (the timed storyboard, highlighting the scene playing in the preview) and *Caption & post* (copy or download the caption sticker, finishing steps). Done steps are remembered per gig in that browser. The admin's notes appear above the steps as **Notes from {company}**.

It lays out by its own width: preview and steps side by side when there is room (preview sticky), the phone mock beside the tabs, timeline and a scene list at medium widths, and stacked with short step labels on phones.

The recording screen (`/reel-kit/wallet`) renders the real creator wallet view inside a copy of the dashboard shell, filled with the gig's figures and the creator's first name. Figures travel in the URL, so it needs no sign-in and shows no account data; the brand line reads **Demo workspace** (and the phone header shows a Demo tag) so the screen is never mistaken for a real account. **Play take** (Space) runs an optional 3-second countdown, then a directed take of about 7 seconds: the figures count up from zero while the Reel earnings card glows, a payout notification drops in, and the page scrolls to the payout cycles and breakdown (S turns the auto-scroll off); T toggles the notification, R resets, F toggles full screen, H hides the controls, and the controls and cursor hide on their own while filming. The screen stays awake during takes where the browser supports it, and reduced-motion settings skip the count-up. The page is excluded from search engines.
