# Harbor SSH design

## 1. Theme
A quiet, dense desktop tool for Chinese-speaking developers. Warm paper navigation anchors a graphite terminal workspace. The terminal is the visual center; no sample servers or decorative dashboards.

## 2. Palette
Paper #f3f1eb, navigation selection #e0e5d8, forest button #2d3c30, workspace #202326, terminal #17191b, terminal text #d9dcd6, amber action #e1af64, error #aa4c3e.

## 3. Typography
System Apple UI and PingFang SC for native Chinese legibility. Menlo for addresses and terminal. UI 11–14px, heading 24px, terminal 14px. Chinese prose line-height 1.7–1.9. No external fonts or network assets.

## 4. Components
Buttons use 7px radius and 40px minimum targets. Inputs share the radius with a visible focus outline. Host rows use a filled selection state. Native dialog provides focus trapping. Ordinary lists scroll inside their region.

## 5. Layout
Sidebar 276px, remaining width for one terminal. Workspace padding 32px. Gaps follow 8/12/16/24/32px. Compact tabs/actions and footer remain fixed while terminal fits available space.

## 6. Depth
Flat adjacent surfaces; terminal canvas is darker than workspace. Only dialogs use strong shadows. Radius scale: 4px badges, 7px controls, 9px terminal, 12px dialogs.

## 7. Rules
No mock hosts. Secret persistence is explicit and opt-in. No remote HTML. No ornamental gradients, card grid, icons from multiple libraries, or terminal logging. Every connection presents real state. Terminal escape sequences cannot write the clipboard through OSC 52.

## 8. Window behavior
Normal window 1220×790. Minimum 900×600. Below 1040px sidebar contracts to 236px and tabs scroll while compact actions remain visible. Dialogs fit viewport and scroll. Terminal fits via ResizeObserver.

## 9. Extension guide
Use #e1af64 with #292b22 text for the one primary action; 7px radius, 40px minimum height, 12px label. Host rows use #e0e5d8 selection and 13px semibold names. Terminal headings use #c1c9bd, 15px normal weight. Frequent keyboard actions never animate; pointer buttons have a .97 press scale. Keep the page local and utility-focused.

## Batch 2 extension

Reuse the existing paper/graphite/amber palette, 7px controls, system Chinese typography and native dialog container. The left footer now exposes the encrypted identity library. The terminal header is a horizontally scrollable tablist with independent close controls, arrow-key navigation and no switch animation. Each hidden terminal remains mounted so its in-memory buffer and flow control continue to work. Active tabs scroll into view without animation.

Identity summaries show name, username and authentication method; no saved secrets are rendered into form values. Secret fields use explicit keep/replace/clear selectors. Private-key file imports display only a filename and token state. Server authentication text is plain React text with echo-controlled inputs, always associated with a named host. The identity-unavailable state is part of the same app, not a replacement error page. Restarted tabs explicitly show an idle state and require a connect action.

## Batch 3 extension

Keep native dialogs, the existing amber action, paper background, 7px controls and system typography. Each terminal adds a quiet file/forward entry above its stage. One wider native dialog switches between SFTP and local forwarding. File and transfer lists scroll independently; the title/close control remains sticky for long content. Directory replies cannot overwrite a path the user is currently typing. The minimum window remains 900×600.

Connection dialogs offer an unchecked remember-password/passphrase option beside the secret input; saved identities never reveal the value. Temporary jump credentials are clearly separated and show the jump host. Fingerprint questions and interactive challenges name the hop actually being authenticated. Each session owns its transfers and forwards, and closing the utility process ends both.

## Batch 4 extension

Remove the breadcrumb/privacy strip and the entire host title/address/action block requested in the screenshot. Move edit/delete/new-tab/connect actions into the tab toolbar; preserve file/forward access. The accessible page heading remains screen-reader-only. Use 32px compact toolbar controls; retain existing paper/graphite/amber tokens.

Host edits are allowed during a session. Each terminal displays its immutable connection snapshot and marks changed connection settings as effective on next connect. Identity edits/deletions retain existing active-use guards. Check three consumers: normal workspace, 900×600 workspace, host editor; screenshots and measured geometry are recorded in the batch 4 report.
