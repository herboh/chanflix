# Welcome to Chanflix

Chanflix is your personal media request portal. Request movies and TV shows, and they'll be added to our shared Plex library for everyone to enjoy.

---

## Quick Start

### Step 1: Sign In with Plex
Use your Plex account to sign in. No separate account needed - if you have access to our Plex server, you can use Chanflix.

### Step 2: Search for Something
Type any movie or TV show name in the search bar at the top. You'll see results from millions of titles.

### Step 3: Request It
Click on what you want, then hit the **Request** button. That's it! You'll get a notification when it's ready to watch.

### Step 4: Watch in Plex
Once available, open Plex and find your content in the appropriate library. You can also click the **Play** button directly from Chanflix.

---

## Making Requests

### Movies
1. Search for the movie
2. Click to open its page
3. Click **Request**
4. Wait for it to be downloaded (usually minutes to hours)

### TV Shows
1. Search for the show
2. Click to open its page
3. Choose what to request:
   - **All Seasons** - Request the entire series
   - **Specific Seasons** - Pick only the seasons you want
4. Submit your request

### Request Status
- **Pending** - Waiting for approval
- **Processing** - Approved and downloading
- **Available** - Ready to watch in Plex
- **Partially Available** - Some episodes ready, others still processing
- **Declined** - Request was not approved

### Managing Your Requests
Go to **Requests** in the sidebar to see all your requests. You can cancel pending requests if you change your mind.

---

## Understanding the Libraries

Our Plex server has separate libraries for different content types and qualities:

### Movies
- **Movies** - Standard quality films (1080p)
- **Movies 4K** - Ultra HD films (4K/2160p) for supported devices

### TV Shows
- **TV Shows** - Standard quality series (1080p)
- **TV Shows 4K** - Ultra HD series when available

### How Content Gets Organized
When you request something, it automatically goes to the right library based on quality. You don't need to do anything special - just request and watch.

---

## 4K vs 1080p: What You Need to Know

### The Simple Version
- **1080p** works on everything and looks great
- **4K** looks better but needs a compatible TV and good internet

### Which Should You Request?

**Request 4K if you have:**
- A 4K TV or monitor
- Fast, stable internet (25+ Mbps recommended)
- A device that can play 4K (Apple TV 4K, Nvidia Shield, smart TV apps, etc.)

**Stick with 1080p if:**
- You mainly watch on phones, tablets, or laptops
- Your internet is slow or unreliable
- You're not sure what your setup supports

### What Happens If You Play 4K on a Non-4K Device?
Plex will automatically convert (transcode) the video to fit your device. This works, but uses server resources. When possible, play content that matches your device's capabilities.

---

## Playback and Streaming

### Direct Play vs Transcoding

**Direct Play** (Best)
Your device plays the file exactly as stored. No conversion needed. This gives the best quality and uses minimal server resources.

**Direct Stream**
The video plays as-is but the audio or container format is converted. Still very efficient.

**Transcoding**
The server converts the video in real-time. This happens when:
- Your device can't play the video format
- Your internet is too slow for the original quality
- Subtitles need to be burned into the video

### Getting the Best Playback

1. **Use a capable device** - Smart TV apps, Apple TV, Roku, and Nvidia Shield handle most formats natively
2. **Use wired internet when possible** - WiFi can be inconsistent for 4K content
3. **Check your Plex settings** - Make sure quality isn't artificially limited
4. **Use text subtitles** - Image-based subtitles (PGS) often force transcoding

### Recommended Plex Settings

In the Plex app, go to Settings > Video Quality:
- **Home streaming**: Maximum or Original
- **Remote streaming**: Original (if your internet supports it) or a lower setting if needed

---

## Advanced Topics

### How the Request System Works

When you submit a request:
1. **Chanflix** receives your request and checks if it needs approval
2. **Radarr** (movies) or **Sonarr** (TV) searches for the best available release
3. The download client fetches the content
4. Once complete, it's moved to the Plex library
5. Plex scans and adds it to your available content
6. You receive a notification that it's ready

### Understanding Quality Profiles

Content is downloaded based on quality profiles that prioritize:
- **Resolution** (4K > 1080p > 720p)
- **Source** (Blu-ray > Web-DL > HDTV)
- **Audio** (Atmos/TrueHD > DTS-HD > AC3)
- **File size** (balanced for storage)

You don't control these directly, but understanding them helps set expectations for when content becomes available.

### Why Some Requests Take Longer

- **New releases** - May not be available in good quality yet
- **Obscure content** - Fewer sources means longer search times
- **4K content** - Takes longer to download due to file size
- **Full TV series** - Many episodes = many downloads

### Transcoding Deep Dive

Transcoding happens on the Plex server and uses CPU/GPU power. Common triggers:

| Scenario | Result |
|----------|--------|
| 4K HDR on non-HDR display | Transcodes to SDR |
| HEVC/H.265 on older device | Transcodes to H.264 |
| High bitrate on slow connection | Transcodes to lower bitrate |
| PGS/VOBSUB subtitles | Forces full transcode |
| Audio format not supported | Audio transcoded (video direct) |

**To avoid transcoding:**
- Use modern streaming devices (Apple TV 4K, Nvidia Shield Pro)
- Use SRT/ASS subtitles instead of PGS when possible
- Ensure your device supports HEVC and HDR if watching 4K
- Connect via ethernet for consistent bandwidth

### Plex Apps and Device Recommendations

**Best experience (direct play almost everything):**
- Nvidia Shield Pro
- Apple TV 4K
- Desktop Plex app (Windows/Mac/Linux)

**Good experience:**
- Smart TV apps (LG, Samsung, Sony)
- Roku Ultra
- Fire TV Stick 4K Max
- Gaming consoles (PS5, Xbox Series X)

**Functional but limited:**
- Web browser (some codecs not supported)
- Older streaming sticks
- Mobile devices on cellular

### Storage and Library Organization

Content is stored on the server's drives with this typical structure:
```
/movies/Movie Name (Year)/Movie Name (Year).mkv
/movies4k/Movie Name (Year)/Movie Name (Year).mkv
/tv/Show Name/Season 01/Show Name - S01E01 - Episode Title.mkv
```

Plex reads metadata from online databases (TMDB, TVDB) to display proper artwork, descriptions, and organize content correctly.

---

## Troubleshooting

### Content Not Playing
1. Try a different quality setting in Plex
2. Try a different device
3. Check if other content plays (isolate the issue)
4. Report the issue through Chanflix

### Request Stuck on "Processing"
Some content takes time. If it's been more than 24 hours for a movie or 48 hours for a TV season, report it.

### Can't Find Content in Plex
1. Make sure the request shows as "Available" in Chanflix
2. Check you're looking in the right library (Movies vs Movies 4K)
3. Search by name in Plex
4. Wait a few minutes - Plex may still be scanning

### Poor Video Quality
1. Check your Plex quality settings
2. Ensure your internet speed supports the quality
3. Try a wired connection
4. The source file may be lower quality than expected

---

## Getting Help

1. **Check the FAQ** - Common questions answered
2. **Report an Issue** - Use the Issues page for content problems
3. **Community Board** - Ask questions or discuss with other users
