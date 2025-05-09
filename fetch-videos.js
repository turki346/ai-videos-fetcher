const admin = require('firebase-admin');
const axios = require('axios');
const { format } = require('date-fns');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const MAX_DAILY_VIDEOS = 40;
const TARGET_HOUR = 18;
const REQUEST_DELAY = 1500;

const CHANNELS = [
'UC9UxdkWXNsRFgM-MF8Brt6g', // Rezero72
'UCtc7rzdsalXrtQGIQra7LtA', // Best Movie Moments and Clips
'UCzu8CMR8o5vF8yMLSZSkXFg', // FlexxFlixx
'UC8plQBFksDc_7Eecu3ezDSA', // irongers edits
'UCjCg64JjmXR2mc8vg1NyClQ', // Sartre Nick
'UCEzw0zwo-L_355bo28jjAkQ', // AK TOP STAR MOVIES
'UCUOMzT3_Ty5mO9Hx9tcXITQ', //GarrasReales
'UC-U6hnCuuhVGHdkCJ--NfgA', // Woof World
'UCGt3d14D3wiqpFTIoqUMw7Q', //  top
'UCgoKH0e1n5II305aJamUnWA', // Abirz Kitchen
'UCdY_pd5-KfcP1_nDL1tpthQ', // Chef le3roubi
'UCIEv3lZ_tNXHzL3ox-_uUGQ', // Gordon Ramsay
'UCDT9Sc8YgtT7Qq8dqe4sgHg', // CHEF OMAR
'UCV4RB6eqmfj358xw3KZmxoA', // Anas Elshayib
'UCOk1u4xi35qArG3kcyMEkFA', // Tefwija Official 
'UCqPDRC1DvTi2VC3WPLlY7qQ', // Azza Zarour
'UCN0quATAyfmTs7mqdtzPq9Q', // Leen AbouShaar
'UCf9wV1445sWowaraXZQa91Q', //HANODY AWESOME
'UC4FOqaFe3XJyWQzT-Kha1aA', // Movie Review
'UCKXrc0_1V2E5OvA-HVeefnA', // AurEdits
'UCp1yc5FhOrIsGPPQnBrN7dg', // DZZ
'UCiRZqLTh6xU1Ew1UIvLt0jw', // Tarek Habib
'UC-4KnPMmZzwAzW7SbVATUZQ', // AJ
'UCPOw2O3_uZ1doro9iR4x6vw', // mmoshaya
'UCilwZiBBfI9X6yiZRzWty8Q', // FaZe Rug
'UC70Dib4MvFfT1tU6MqeyHpQ', // Preston
'UCo6djXsiuTc6fIIzSAT3i9A', // AlwaysPiliPili
'UCbhmcMr9RcC-kZ-SkJ5q5nA', // Teman Suara ASMR
'UCAXEGk-l_ioBMvHa9_uHJjg', // A&B Things
'UCblfuW_4rakIf2h6aqANefA', // Red Bull
'UCNhk8lTJR0wPFoC9kbS0T1Q', // Bay Toon
'UCeSiZk_08JbCGDjdgwqsgEQ', // EGY otaku
'UClR74BSOFXxMOKtuaaPu91Q', // Younes Zarou
'UC86suRFnqiw8zN6LIYxddYQ', // Khaby Lame
'UCCNaMMlI3cOc7yFg52riTqg', // Julius Dein
'UCh-xjYdT-Mha2LBGVsTfOlw', // Sossam
'UCq8DICunczvLuJJq414110A', // Zach King
'UCxUPU7lI249SW_j5WgByJRA', // Mohamad Adnan
'UCyhqIgshhPDSR-nYe8OHWBQ', // cuisine Tima 
'UCNFSZXNim4-cBHU02Hy7R4Q'  // Suhaib
];

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
});
const db = admin.firestore();

const channelCache = new Map();

async function fetchVideos() {
    try {
        if (!isRightTime()) {
            console.log('⏳ Not the scheduled time (6 PM Morocco)');
            return;
        }

        if (await isDailyLimitReached()) {
            console.log(`🎯 Daily limit reached (${MAX_DAILY_VIDEOS} videos)`);
            return;
        }

        const videos = await fetchAllVideos();
        
        if (videos.length > 0) {
            await saveVideos(videos);
            console.log(
                `✅ Added ${videos.length} videos\n` +
                `📊 Quota used: ${calculateQuota(videos.length)} units\n` +
                `⏰ ${format(new Date(), 'yyyy-MM-dd HH:mm')}`
            );
        } else {
            console.log('⚠️ No new videos found today');
        }

        await logExecution(videos.length);

    } catch (error) {
        console.error('❌ Main error:', error);
        await logError(error);
        process.exit(0);
    }
}

function isRightTime() {
    const now = new Date();
    const moroccoTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Casablanca' }));
    return moroccoTime.getHours() === TARGET_HOUR;
}

async function isDailyLimitReached() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const snapshot = await db.collection('videos')
        .where('timestamp', '>=', todayStart)
        .count()
        .get();

    return snapshot.data().count >= MAX_DAILY_VIDEOS;
}

async function fetchAllVideos() {
    const videos = [];
    
    for (const channelId of CHANNELS) {
        try {
            await delay(REQUEST_DELAY);
            const video = await fetchChannelVideo(channelId);
            if (video) videos.push(video);
        } catch (error) {
            console.error(`❌ ${channelId}:`, error.message);
        }
    }
    
    return videos;
}

async function fetchChannelVideo(channelId) {
    const videoId = await getLatestVideoId(channelId);
    if (!videoId) return null;

    if (await isVideoExists(videoId)) {
        console.log(`⏭️ Skipping existing video: ${videoId}`);
        return null;
    }

    return await getVideoDetails(videoId);
}

async function getLatestVideoId(channelId) {
    const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}` +
        `&channelId=${channelId}&part=snippet&order=date` +
        `&maxResults=1&type=video&videoDuration=short` +
        `&fields=items(id(videoId),snippet(title))`
    );

    return response.data.items[0]?.id.videoId;
}

async function isVideoExists(videoId) {
    const doc = await db.collection('videos').doc(videoId).get();
    return doc.exists;
}

async function getVideoDetails(videoId) {
    const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/videos?key=${YOUTUBE_API_KEY}` +
        `&id=${videoId}&part=snippet,contentDetails,statistics` +
        `&fields=items(snippet(title,description,thumbnails/high,channelId),contentDetails/duration,statistics)`
    );

    const item = response.data.items[0];
    if (!item) return null;

    const duration = parseDuration(item.contentDetails.duration);
    if (duration > 180) return null;

    const channelInfo = await getChannelInfo(item.snippet.channelId);
    
    // Extract music information from description
    const musicInfo = extractMusicInfo(item.snippet.description);
    
    return {
        videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails.high.url,
        duration: item.contentDetails.duration,
        durationSeconds: duration,
        creatorUsername: channelInfo.title,
        creatorAvatar: channelInfo.avatar,
        isVerified: channelInfo.isVerified,
        likes: parseInt(item.statistics?.likeCount || 0),
        comments: parseInt(item.statistics?.commentCount || 0),
        music: musicInfo,
        isAI: true,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
}

function extractMusicInfo(description) {
    // Patterns to detect music information
    const patterns = [
        /Music in this video[\s\S]*?Learn more[\s\S]*?Song\s*(.*?)\s*Artist\s*(.*?)\s*Licensed to YouTube by/i,
        /🎵 Music[\s:]*([^\n]*)/i,
        /Track:?\s*(.*?)\s*by\s*(.*?)(?:\n|$)/i,
        /Song:?\s*(.*?)(?:\n|$)/i,
        /Sound:?\s*(.*?)(?:\n|$)/i,
        /Original sound - (.*)/i
    ];

    for (const pattern of patterns) {
        const match = description.match(pattern);
        if (match) {
            if (match[1] && match[2]) {
                return {
                    type: 'youtube_music',
                    song: match[1].trim(),
                    artist: match[2].trim(),
                    isOriginal: false
                };
            } else if (match[1]) {
                return {
                    type: match[0].includes('Original sound') ? 'original_sound' : 'unknown_music',
                    song: match[1].trim(),
                    artist: null,
                    isOriginal: match[0].includes('Original sound')
                };
            }
        }
    }

    // Check for common music tags
    if (description.includes('epidemicsound') || description.includes('Epidemic Sound')) {
        return {
            type: 'epidemic_sound',
            song: null,
            artist: null,
            isOriginal: false
        };
    }

    if (description.includes('No copyright music') || description.includes('NCS')) {
        return {
            type: 'no_copyright_sound',
            song: null,
            artist: null,
            isOriginal: false
        };
    }

    // Default to original sound if no music info found
    return {
        type: 'original_sound',
        song: null,
        artist: null,
        isOriginal: true
    };
}

async function getChannelInfo(channelId) {
    if (channelCache.has(channelId)) {
        return channelCache.get(channelId);
    }

    const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/channels?key=${YOUTUBE_API_KEY}` +
        `&id=${channelId}&part=snippet,status` +
        `&fields=items(snippet(title,thumbnails/high/url),status)`
    );

    const data = response.data.items[0];
    const result = {
        title: data.snippet.title,
        avatar: data.snippet.thumbnails.high.url,
        isVerified: data.status?.longUploadsStatus === "eligible"
    };

    channelCache.set(channelId, result);
    return result;
}

async function saveVideos(videos) {
    const batch = db.batch();
    
    videos.forEach(video => {
        const ref = db.collection('videos').doc(video.videoId);
        batch.set(ref, video);
    });
    
    await batch.commit();
}

async function logExecution(count) {
    await db.collection('logs').add({
        date: admin.firestore.FieldValue.serverTimestamp(),
        videoCount: count,
        quotaUsed: calculateQuota(count)
    });
}

async function logError(error) {
    await db.collection('errors').add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        message: error.message,
        stack: error.stack
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDuration(duration) {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    return (parseInt(match?.[1] || 0) * 3600) +
          (parseInt(match?.[2] || 0) * 60) +
          (parseInt(match?.[3] || 0));
}

function calculateQuota(videoCount) {
    return videoCount * 102;
}

fetchVideos();
