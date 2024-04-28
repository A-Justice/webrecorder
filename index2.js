const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

(async () => {
    const videoSeconds = 300;
    const videoMiliseconds = videoSeconds * 1000;
    const frameRate = 25;
    const loopControl = 1000/frameRate;
    deleteAllFilesInDirectory("shots");
    const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
    console.log("Browser",browser.connected);
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(600000);
    await page.goto('https://stage4.heatmap.com/?access=v5637true1');

    await page.type('#login_form_login', 'fortune.tede@pilgrimconsulting.team');
    await page.type('#login_form_password', 'Fortune$123');
    await page.click('#login_form_submit');

    await page.waitForNavigation();

    await page.goto('https://stage4.heatmap.com/index.php?module=Widgetize&action=iframe&moduleToWidgetize=HeatmapSessionRecording&actionToWidgetize=replayRecording&idLogHsr=4421200918847005404&idSite=164&idVisit=4421200327000006401');

    console.log("Opened");
    // Wait for the element to be visible
    await page.waitForSelector('#recordingPlayer');

    // Get the bounding box of the element
    const element = await page.$('#recordingPlayer');
    const boundingBox = await element.boundingBox();

    // Capture screenshots of the element
    //const screenshots = [];

    for (let i = 0; i < videoMiliseconds; i+=loopControl) { // Capture 100 frames, adjust as needed
        if(i >= videoMiliseconds){
            await browser.close();
            // console.log(screenshots);
            await combineScreenshotsIntoVideo();
            return;
        }
        
        console.log("Counter",i);
        
        const screenshot = await page.screenshot({
            clip: {
                x: boundingBox.x,
                y: boundingBox.y,
                width: boundingBox.width,
                height: boundingBox.height
            },
            type: 'jpeg',
            path: `./shots/${Date.now().toString()}.jpeg`
        });

        await wait(loopControl)
    }

   

    // Convert screenshots to video using ffmpeg
    // Example command: ffmpeg -framerate 10 -i screenshot_%03d.jpg -c:v libx264 -r 30 -pix_fmt yuv420p out.mp4
    // Make sure to install ffmpeg and adjust the command based on your needs

    
})();

async function wait(seconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, seconds);
    });
}


async function combineScreenshotsIntoVideo() {
    // Combine screenshots into video using ffmpeg

    console.log("Combining using ffmpeg");
    exec('ffmpeg -y -framerate 25 -pattern_type glob -i "shots/*.jpeg" -c:v libx264 -r 25 -pix_fmt yuv420p video.mp4', (error, stdout, stderr) => {
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

function deleteAllFilesInDirectory(directoryPath) {
    if (fs.existsSync(directoryPath)) {
      fs.readdirSync(directoryPath).forEach(file => {
        const filePath = path.join(directoryPath, file);
        if (fs.lstatSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      });
    }
  }
  
  

