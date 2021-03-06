import enquirer from 'enquirer';
import axios from "axios";
import cheerio from "cheerio";
import boxen from "boxen";
import ora from "ora";
import chalk from "chalk";
import { LocalStorage } from "node-localstorage";
const localStorage = new LocalStorage('./scratch');

const espnHomepageUrl = "https://espn.com/";
const headlineSelector = ".col-three .headlineStack li a";
const sportsSelector = "#global-nav ul li a";

export const getPageContents = async (pageUrl) => {
  const response = await axios.get(pageUrl);
  const html = response.data;
  const $cheerioLoader = cheerio.load(html);
  return $cheerioLoader;
}

export const getHeadlines = ($page) => {
  const headlines = [];
  $page(headlineSelector).each(function (i, elem) {
    const postDotComText = $page(this).attr('href');
    const url = new URL(postDotComText, espnHomepageUrl);
    headlines[i] = {
      title: $page(this).text(),
      sport: postDotComText.split("/")[0],
      href: url.href,
      type: "headline",
    }
  });
  return headlines.filter(headline => !headline.href.includes("/insider/"));
};

export const getSports = ($page) => {
  const sports = [];
  $page(sportsSelector).each(function (i, elem) {
    const postDotComText = $page(this).attr('href');
    const url = new URL(postDotComText, espnHomepageUrl);
    sports[i] = {
      title: $page(this).text().trim().split("\n")[0].toLowerCase(),
      href: url.href,
      type: "sport",
    }
  });
  return sports.filter(sport => {
    const pathname = new URL(sport.href).pathname;
    const hasSingleRoute = pathname.replace(/^\//, "").replace(/\/$/, "").split("/").length === 1;
    const isEspn = new URL(sport.href).hostname === "espn.com";
    return isEspn && hasSingleRoute && pathname.length > 1;
  });
}

export const getArticleText = async (articleUrl) => {
  const response = await axios.get(articleUrl);
  const html = response.data;
  const $ = cheerio.load(html);

  const paragraphSelector = ".article-body p";
  const paragraphs = [articleUrl];
  $(paragraphSelector).each(function (i, elem) {
    paragraphs[i] = $(this).text();
  });
  return paragraphs.join("\n\n");
};

const showTodaysUsage = () => {
  const dateOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };
  const now = new Date();
  const dateString = now.toLocaleString('en-US', dateOptions);
  const todaysRuns = parseInt(localStorage.getItem(dateString)) || 0;
  const chalkColor = todaysRuns < 5 ? "green" : todaysRuns > 10 ? "red" : "yellow";
  console.log(chalk[chalkColor](`Times you've checked ESPN today: ${todaysRuns}`));
  localStorage.setItem(dateString, todaysRuns + 1);
}

const runCli = async () => {
  showTodaysUsage();
  console.log("Thanks for consuming sports headlines responsibly!");
  const spinner = ora("Getting headlines...").start();
  const $homepage = await getPageContents(espnHomepageUrl);
  spinner.succeed("ESPN headlines received");
  const homepageHeadlines = getHeadlines($homepage);
  const sports = getSports($homepage);
  const headlinesBySport = {};
  for (let sport of sports) {
    getPageContents(sport.href).then(($sportPage) => {
      const headlines = getHeadlines($sportPage);
      headlinesBySport[sport.title] = headlines;
    }).catch((e) => {
      console.log("there was an issue getting headlines for a certain sport", e);
    });
  }

  const selectionTypes = {
    HEADLINE: "headline",
    SPORT: "sport",
    MORE: "more"
  };

  const genericOptions = {
    HOMEPAGE_HEADLINES: { title: "see homepage headlines" },
    LIST_SPORTS: { title: "see headlines for specific sports", type: selectionTypes.MORE },
    OTHER_SPORTS: { title: "see headlines for other sports", type: selectionTypes.MORE },
    EXIT: { title: "exit" },
  };

  let selection;
  let selectionTitle;
  let articleText;
  let currentPrompt;
  let exit = false;
  while(!exit) {
    currentPrompt?.clear();
    if (selection?.title === genericOptions.EXIT.title) {
      exit = true;
      break;
    }
    if (!selection || selection.title === genericOptions.HOMEPAGE_HEADLINES.title) {
      currentPrompt = new enquirer.Select({
        name: 'color',
        message: 'What story shall we read?',
        choices: [...homepageHeadlines.map(item => item.title), genericOptions.LIST_SPORTS.title, genericOptions.EXIT.title]
      });
    }
    else if (selection.type === selectionTypes.MORE) {
      currentPrompt = new enquirer.Select({
        name: 'color',
        message: 'Which sport would you like headlines for?',
        choices: sports.map(choice => choice.title)
      });
    }
    else if (selection.type === selectionTypes.SPORT) {
      const sportHeadlines = headlinesBySport[selection.title];
      const sportChoices = sportHeadlines.map(option => option.title);
      currentPrompt = new enquirer.Select({
        name: 'color',
        message: `Select a ${selection.title} headline to get article text`,
        choices: [...sportChoices, genericOptions.HOMEPAGE_HEADLINES.title, genericOptions.OTHER_SPORTS.title, genericOptions.EXIT.title]
      });
    }
    else if (selection.type === selectionTypes.HEADLINE) {
      articleText = await getArticleText(selection.href);
      console.log(boxen(selection.href, { borderStyle: 'bold'}));
      console.log(boxen(articleText, { borderStyle: 'singleDouble'}));
      currentPrompt = new enquirer.Select({
        name: 'color',
        message: 'Done reading? What next?',
        choices: [genericOptions.HOMEPAGE_HEADLINES.title, genericOptions.LIST_SPORTS.title, genericOptions.EXIT.title]
      });
      articleText = "";
    }

    selectionTitle = await currentPrompt.run();
    const combinedSportHeadlines = Object.values(headlinesBySport).reduce((accumulator, item) => {
      return [...accumulator, ...item];
    }, [])
    const allOptions = [...Object.values(genericOptions), ...homepageHeadlines, ...sports, ...combinedSportHeadlines];
    selection = allOptions.find(item => item.title === selectionTitle);
  }
  console.log("Thanks for using the ESPN cli!");
  return;
}
