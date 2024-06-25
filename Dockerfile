FROM satantime/puppeteer-node:18.20.1

WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg

# Install Chrome using Puppeteer
RUN npx puppeteer browsers install chrome

COPY ./package.json .

RUN npm install

COPY . .

EXPOSE 80


CMD ["node","index.js"]


#docker build -t pup .
#docker run -it -p 80:80 -v /Users/macbook/Desktop/Desk/projects/POC/HSR/allVideos:/app/allVideos -v /Users/macbook/Desktop/Desk/projects/POC/HSR/allShots:/app/allShots pup
#docker 