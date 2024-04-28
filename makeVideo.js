const { exec } = require('child_process');

(async ()=>{
    await combineScreenshotsIntoVideo();
})();

async function combineScreenshotsIntoVideo() {
    exec('ffmpeg -y -framerate 25 -pattern_type glob -i "allShots/shots-7.594206356368716-763783112770.6222/*.jpeg" -c:v libx264 -r 25 -pix_fmt yuv420p ./allVideos/video-123.mp4', (error, stdout, stderr) => {
        if (error) {
          console.error(`ffmpeg error: ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`ffmpeg stderr: ${stderr}`);
          return;
        }
        console.log('Video created successfully!');
      });
}
