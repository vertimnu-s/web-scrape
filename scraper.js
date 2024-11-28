import path from "path";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import clipboardy from "clipboardy";
import EventEmitter from "node:events";
import sound from "sound-play";

const MAX_TIMEOUT = 5;


//CSS selectors for Udemy website elements, in order
const SELECTORS = [
    "div.course-landing-page__main-content > div > h1",//Course title
    "span[data-purpose='video-content-length']",//Hours and minutes
    "#main-content-anchor > div.paid-course-landing-page__body > div > div.topic-navigation-module--topic-navigation--wCbdV > ul > li:nth-child(1) > a > span",//Udemy Skills -- one skill only for now
    ".star-rating-module--rating-number--2-qA2",//Star rating
    "div.clp-lead__element-item.clp-lead__element-item--row > a > span:nth-child(2)",//Num of ratings
    ".enrollment",//Num of students
    "div.clp-lead__element-meta > div:nth-child(1) > div > span",//Last updated
    ".instructor--instructor__image-and-stats--6Nbsa > .ud-unstyled-list > li:nth-child(1) > div > div",//Instructor Rating
    ".instructor--instructor__image-and-stats--6Nbsa > .ud-unstyled-list > li:nth-child(2) > div > div",//Instructor Reviews
    ".instructor--instructor__image-and-stats--6Nbsa > .ud-unstyled-list > li:nth-child(3) > div > div",//Instructor Students
    ".instructor--instructor__image-and-stats--6Nbsa > .ud-unstyled-list > li:nth-child(4) > div > div",//Instructor Courses
];

//A class that checks every 100ms to see if the contents of the clipboard have changed
class ClipboardEmitter extends EventEmitter {
    constructor(...args) {
        super(...args);
        this.previousContent = null;

        setInterval(() => {
            try {
                const currentContent = clipboardy.readSync();
                //If the content isn't the same as it was 100ms ago, we emit a "copy" event with the new content
                if (currentContent !== this.previousContent) {
                    this.previousContent = currentContent;
                    this.emit("copy", currentContent);
                }
            } catch (er) {
                console.error("Couldn't read clipboard contents:", er);
            }
        }, 100)
    }
    //We can manually overwrite the contents so the emitter doesn't emit when we update the clipboard content ourselves
    setNewContent(content) {
        this.previousContent = content;
    }
};
const clipboardEmitter = new ClipboardEmitter();

//StealthPlugin circumvents CloudFlare's bot check
puppeteer.use(StealthPlugin());

//We launch a new Chromium browser to scrape data, we could also connect to an existing Opera/Chrome browser using debugging port
puppeteer.launch({
    //Point to a chromium-based browser
    // executablePath: path.resolve("C:/Program Files/Google/Chrome/Application/chrome.exe"),
    // executablePath: path.resolve("C:/Users/Vertimnus/AppData/Local/Programs/Opera GX/opera.exe"),
    headless: false
}).then(async (browser) => {
    //We get the existing browser tab or create a new one if it doesn't exist
    let page = (await browser.pages())[0];
    if (!page) {
        page = await browser.newPage();
        await page.setViewport({
            width: 1280,
            height: 720
        })
    }

    //We listen for the "copy" event from our ClipboardEmitter class
    clipboardEmitter.on("copy", async (data) => {
        console.log(data);
        //We check if the clipboard data content is a valid URL
        if (!isValidUrl(data)) {
            console.warn(`Clipboard data: ${data} is not a valid URL`);
            return;
        }
        //We check if the url is a Udemy URL, we could further check if it leads to udemy.com/COURSES
        if (!new URL(data).host.endsWith("udemy.com")) {
            console.warn(`Clipboard data: ${data} is not a valid UDEMY URL`);
            return;
        }

        //We try to scrape the data
        try {
            await page.goto(data, {waitUntil: "load"});
            //We go through each selector and get its text content
            let contents = await Promise.all(SELECTORS.map(async (selector, i) => {
                try{
                    const timeoutController = new AbortController();
                    setTimeout(() => timeoutController.abort(), MAX_TIMEOUT*1000);
                    const locator = await page.locator(selector).waitHandle({signal: timeoutController.signal});
                    return locator.evaluate(el => el.textContent);
                }catch(er){
                    if (i==2) 
                        return "";
                    else 
                        throw new Error(`Couldn't find ${selector}. Timed out after ${MAX_TIMEOUT} seconds.`)
                }
            }))
            //Get the hours and minutes separately
            //TODO: for courses of 1 hour or less, this returns NaN. maybe use something other than mathfloor, or check if it has some flattening option
            const courseLength = Number(contents[1].replace(" hours on-demand video", ""))
            const hours = Math.floor(courseLength)
            const minutes = Math.floor(courseLength % 1 * 60)
            console.log(contents)
            //Create a new array and insert all the data in proper order
            let contentsNormalized = [
                `=HYPERLINK("${data}", "Link")`,
                "Alpha Link",
                contents[0], //title
                " ", //Udemy Level leave empty for now cause I can't scrape it from the landing page
                hours,
                minutes,
                "", //calc minutes leave empty
                contents[2], //Udemy skill
                contents[3], //Star rating
                contents[4].replace(" ratings", "").replace("(", "").replace(")", ""), //No of ratings
                contents[5].replace(" students", ""), //No of students
                contents[6].replace("Last updated ", ""), //Last updated
                contents[7].replace(" Instructor Rating", ""), //Instructor Rating
                contents[8].replace(" Reviews", ""), //Instructor Reviews
                contents[9].replace(" Students", ""), //Instructor Students
                contents[10].replace(" Courses", "") //Instructor Courses
            ];
            //Excel considers new tab as next column, we join the text contents into a tabulated string
            contentsNormalized = contentsNormalized.join("\t");
            //We paste the excel-ready content into the clipboard
            await clipboardy.write(contentsNormalized);
            //We manually owerwrite the clipboardEmitter's last checked value, preventing it from firing a "copy" event
            clipboardEmitter.setNewContent(contentsNormalized);
            //Copy processed data into clipboard and play a short success sound
            sound.play("C:/Windows/Media/ding-sound.mp3");
            console.log(contentsNormalized);
        } catch (er) {
            sound.play("C:/Windows/Media/chord.wav");
            console.error(`Couldn't scrape data from ${data}: ${er}`);
        }
    })
    console.log("Listening for clipboard changes");
})

function isValidUrl(url) {
    try {
        //URL constructor throws an error if the provided url isn't valid
        const _url = new URL(url);
        return true;
    } catch {
        return false;
    }
}

