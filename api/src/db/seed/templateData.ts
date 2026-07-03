export type SeedQuestion = {
  text: string;
  a: string;
  b: string;
  c: string;
  d: string;
  correct: 'a' | 'b' | 'c' | 'd';
  type: 'pre' | 'post';
};
export type SeedArea = { name: string; description?: string; questions: SeedQuestion[] };
export type SeedTemplate = { category: string; name: string; areas: SeedArea[] };

// Digital Skills — fully seeded per FR-M1-02 (5 areas x 12 questions/area, split
// 6 "pre" + 6 "post" so pre/post assessments draw parallel, non-identical item sets).
const digitalSkills: SeedTemplate = {
  category: 'digital_skills',
  name: 'Digital Skills',
  areas: [
    {
      name: 'Computer & Device Basics',
      questions: [
        { text: "What is the main function of a computer's RAM?", a: 'Store files permanently', b: 'Temporarily hold data the CPU is actively using', c: 'Connect to the internet', d: 'Power the monitor', correct: 'b', type: 'pre' },
        { text: 'Which of these is an input device?', a: 'Monitor', b: 'Printer', c: 'Keyboard', d: 'Speaker', correct: 'c', type: 'pre' },
        { text: 'What does "USB" stand for?', a: 'Universal Serial Bus', b: 'United System Board', c: 'Unified Software Backup', d: 'User Service Bridge', correct: 'a', type: 'pre' },
        { text: 'Which key combination is commonly used to copy text on Windows?', a: 'Ctrl+V', b: 'Ctrl+C', c: 'Ctrl+X', d: 'Ctrl+Z', correct: 'b', type: 'pre' },
        { text: "What is the operating system's main job?", a: 'Manage hardware and run programs', b: 'Only browse the internet', c: 'Only play media files', d: 'Design graphics', correct: 'a', type: 'pre' },
        { text: 'Which of these is a way to safely shut down a computer?', a: 'Unplug it immediately', b: 'Hold the power button until it turns off', c: 'Use the Shut Down option in the menu', d: 'Close the laptop lid only', correct: 'c', type: 'pre' },
        { text: "What is the function of a computer's CPU?", a: 'Store photos', b: 'Process instructions and calculations', c: 'Provide Wi-Fi', d: 'Charge the battery', correct: 'b', type: 'post' },
        { text: 'Which storage device typically holds the most data long-term on a laptop?', a: 'RAM', b: 'Cache', c: 'Hard drive/SSD', d: 'Clipboard', correct: 'c', type: 'post' },
        { text: 'What does "Wi-Fi" allow a device to do?', a: 'Print documents', b: 'Connect wirelessly to a network', c: 'Charge faster', d: 'Scan documents', correct: 'b', type: 'post' },
        { text: 'Which of these best describes a "driver" in computing?', a: 'A person who repairs computers', b: 'Software that lets the OS communicate with hardware', c: 'A type of virus', d: 'A web browser', correct: 'b', type: 'post' },
        { text: 'What should you do before installing software from an unfamiliar website?', a: 'Install immediately', b: 'Verify the source is trustworthy', c: 'Turn off the computer', d: 'Ignore antivirus warnings', correct: 'b', type: 'post' },
        { text: "Which of these extends a laptop's battery life?", a: 'Maximum screen brightness always', b: 'Lowering screen brightness and closing unused apps', c: 'Running many programs at once', d: 'Disabling all updates forever', correct: 'b', type: 'post' },
      ],
    },
    {
      name: 'Internet & Email Literacy',
      questions: [
        { text: 'What symbol is required in every email address?', a: '#', b: '@', c: '%', d: '&', correct: 'b', type: 'pre' },
        { text: 'What is a web browser used for?', a: 'Editing photos', b: 'Accessing websites on the internet', c: 'Compressing files', d: 'Managing print jobs', correct: 'b', type: 'pre' },
        { text: 'Which of these is a search engine?', a: 'Gmail', b: 'Google', c: 'Word', d: 'Excel', correct: 'b', type: 'pre' },
        { text: 'What does "www" stand for in a website address?', a: 'World Wide Web', b: 'Web Wide World', c: 'World Web Wide', d: 'Wide World Web', correct: 'a', type: 'pre' },
        { text: 'What should you check before clicking a link in an email?', a: "The sender's font size", b: 'Whether the link/sender looks legitimate', c: 'The time it was sent', d: "The email's color", correct: 'b', type: 'pre' },
        { text: 'Which of these is a valid email address format?', a: 'name.example.com', b: 'name@example.com', c: 'name#example.com', d: 'name/example.com', correct: 'b', type: 'pre' },
        { text: 'What is "spam" in the context of email?', a: 'Important work email', b: 'Unwanted or unsolicited email', c: 'A file attachment type', d: 'An email folder for drafts', correct: 'b', type: 'post' },
        { text: 'What does "CC" mean when sending an email?', a: 'Carbon Copy — sends a visible copy to another recipient', b: 'Cancel Copy', c: 'Confirm Contact', d: 'Create Contact', correct: 'a', type: 'post' },
        { text: 'Which of these indicates a website may be secure?', a: 'It has ads', b: 'The address starts with "https://"', c: 'It loads slowly', d: 'It has many pop-ups', correct: 'b', type: 'post' },
        { text: 'What is an attachment in an email?', a: 'The subject line', b: 'A file included with the email', c: "The sender's name", d: "The email's signature", correct: 'b', type: 'post' },
        { text: 'What is phishing?', a: 'A method to speed up downloads', b: 'A scam to trick you into revealing personal information', c: 'A type of search filter', d: 'A way to organize emails', correct: 'b', type: 'post' },
        { text: 'Which action helps protect your email account?', a: 'Using a weak, simple password', b: 'Sharing your password with friends', c: 'Enabling two-factor authentication', d: 'Clicking every link you receive', correct: 'c', type: 'post' },
      ],
    },
    {
      name: 'Productivity Tools',
      questions: [
        { text: 'Which application is best for writing a formatted document?', a: 'Word processor', b: 'Spreadsheet', c: 'Media player', d: 'Web browser', correct: 'a', type: 'pre' },
        { text: 'In a spreadsheet, what is a "cell"?', a: 'A chart type', b: 'The intersection of a row and column', c: 'A file extension', d: 'A printing setting', correct: 'b', type: 'pre' },
        { text: 'Which file format is commonly used for spreadsheets?', a: '.docx', b: '.xlsx', c: '.mp3', d: '.png', correct: 'b', type: 'pre' },
        { text: 'What does "Ctrl+S" typically do?', a: 'Search', b: 'Save', c: 'Select all', d: 'Spell check', correct: 'b', type: 'pre' },
        { text: 'In a word processor, what does "bold" formatting do?', a: 'Underlines text', b: 'Makes text thicker/darker', c: 'Changes text color to red', d: 'Deletes text', correct: 'b', type: 'pre' },
        { text: 'What is the purpose of a spreadsheet formula starting with "="?', a: 'To add a comment', b: 'To perform a calculation', c: 'To change the font', d: 'To insert an image', correct: 'b', type: 'pre' },
        { text: 'Which Excel formula adds a range of numbers?', a: '=SUM(A1:A10)', b: '=TEXT(A1)', c: '=BOLD(A1)', d: '=PRINT(A1)', correct: 'a', type: 'post' },
        { text: 'What is a "template" in productivity software?', a: 'A virus', b: 'A pre-formatted starting document', c: 'A printer setting', d: 'A type of font', correct: 'b', type: 'post' },
        { text: 'Which feature lets you check for spelling errors in a document?', a: 'Spell check', b: 'Zoom', c: 'Page break', d: 'Track changes', correct: 'a', type: 'post' },
        { text: 'What does "merge cells" do in a spreadsheet?', a: 'Deletes the cells', b: 'Combines multiple cells into one', c: 'Splits a cell into two', d: 'Colors the cells', correct: 'b', type: 'post' },
        { text: 'What is the purpose of "Track Changes" in a document?', a: 'Records edits made by different users', b: 'Deletes old versions', c: 'Changes the page size', d: 'Adds page numbers', correct: 'a', type: 'post' },
        { text: 'Which shortcut typically undoes the last action?', a: 'Ctrl+P', b: 'Ctrl+Z', c: 'Ctrl+B', d: 'Ctrl+N', correct: 'b', type: 'post' },
      ],
    },
    {
      name: 'Online Safety & Digital Citizenship',
      questions: [
        { text: 'What is a strong password more likely to include?', a: 'Your name and birthdate', b: 'A mix of letters, numbers, and symbols', c: 'The word "password"', d: 'A single common word', correct: 'b', type: 'pre' },
        { text: 'What should you do if a stranger online asks for your bank details?', a: 'Share them if they seem friendly', b: 'Refuse and report the request', c: 'Share only your account number', d: 'Ask them to call you first', correct: 'b', type: 'pre' },
        { text: 'What is malware?', a: 'A helpful system update', b: 'Software designed to harm or exploit devices', c: 'A type of web browser', d: 'An email filter', correct: 'b', type: 'pre' },
        { text: 'Why should you avoid using public Wi-Fi for banking?', a: "It's usually slower", b: 'It can be less secure and put data at risk', c: 'It costs extra money', d: 'It blocks banking apps', correct: 'b', type: 'pre' },
        { text: 'What does "privacy settings" on social media control?', a: 'App download speed', b: 'Who can see your posts and information', c: 'Battery usage', d: 'Internet speed', correct: 'b', type: 'pre' },
        { text: 'What is cyberbullying?', a: 'Playing online games with friends', b: 'Using digital platforms to harass or intimidate someone', c: 'Sharing helpful study tips', d: 'Reporting spam', correct: 'b', type: 'pre' },
        { text: 'What is two-factor authentication?', a: 'Using two different browsers', b: 'An extra security step beyond just a password', c: 'Having two email addresses', d: 'Logging in twice a day', correct: 'b', type: 'post' },
        { text: 'Before sharing a post, what should you consider?', a: 'Nothing, share anything', b: "Whether it's true, kind, and appropriate to share", c: 'Only how many likes it will get', d: 'Only the time of day', correct: 'b', type: 'post' },
        { text: 'What is a digital footprint?', a: 'A type of computer virus', b: 'The trail of data you leave from online activity', c: 'A printer error', d: 'A file compression method', correct: 'b', type: 'post' },
        { text: 'What should you do if you see false information (misinformation) online?', a: 'Share it immediately', b: 'Verify before sharing and consider reporting it', c: 'Ignore verifying and comment anyway', d: 'Forward it to everyone', correct: 'b', type: 'post' },
        { text: 'Why is it risky to reuse the same password across multiple sites?', a: 'It is not risky', b: 'If one site is breached, other accounts become vulnerable', c: 'It slows down login', d: 'It uses more storage', correct: 'b', type: 'post' },
        { text: 'What is appropriate online etiquette (netiquette)?', a: 'Typing in all caps to emphasize everything', b: 'Being respectful and clear in online communication', c: "Ignoring others' messages", d: 'Posting personal information publicly', correct: 'b', type: 'post' },
      ],
    },
    {
      name: 'Social Media & Communication Tools',
      questions: [
        { text: 'What is the purpose of a hashtag (#) on social media?', a: 'To delete a post', b: 'To categorize content and make it discoverable', c: 'To block a user', d: 'To change font size', correct: 'b', type: 'pre' },
        { text: 'What does "DM" commonly mean on social platforms?', a: 'Direct Message', b: 'Delete Media', c: 'Data Manager', d: 'Download Mode', correct: 'a', type: 'pre' },
        { text: 'Which is an example of a video calling tool?', a: 'Zoom', b: 'Excel', c: 'Notepad', d: 'Paint', correct: 'a', type: 'pre' },
        { text: 'What is the purpose of muting a conversation in a messaging app?', a: 'Delete it permanently', b: 'Stop receiving notifications from it without leaving', c: 'Block the sender', d: 'Report the sender', correct: 'b', type: 'pre' },
        { text: 'What does "going viral" mean online?', a: 'A post loading slowly', b: 'Content spreading rapidly and widely', c: 'A device getting a virus', d: 'An account being deleted', correct: 'b', type: 'pre' },
        { text: 'What is a group chat?', a: 'A single conversation between two people', b: 'A conversation involving three or more participants', c: 'An email inbox', d: 'A video only feature', correct: 'b', type: 'pre' },
        { text: 'What is the benefit of using video conferencing for remote meetings?', a: 'It requires no internet', b: 'It allows real-time communication regardless of location', c: 'It only works for one person', d: 'It replaces the need for internet entirely', correct: 'b', type: 'post' },
        { text: 'What does "read receipt" indicate in messaging apps?', a: 'The message was deleted', b: 'The recipient has opened/read the message', c: 'The message failed to send', d: 'The sender blocked you', correct: 'b', type: 'post' },
        { text: 'Which practice improves professional communication in a work chat group?', a: 'Using clear, respectful language', b: 'Sending unrelated memes frequently', c: 'Ignoring messages for days', d: 'Using only emojis', correct: 'a', type: 'post' },
        { text: 'What is the purpose of a status update on messaging apps?', a: 'To permanently delete your account', b: 'To share brief updates visible to your contacts', c: 'To change your password', d: 'To block spam calls', correct: 'b', type: 'post' },
        { text: 'Why might a business use social media analytics?', a: 'To understand audience engagement and reach', b: 'To change the weather forecast', c: 'To repair devices', d: 'To install software', correct: 'a', type: 'post' },
        { text: 'What is an appropriate way to handle a disagreement in an online group chat?', a: 'Respond calmly and privately if needed', b: 'Publicly insult the other person', c: 'Leave angry voice notes repeatedly', d: 'Ignore everyone in the group permanently', correct: 'a', type: 'post' },
      ],
    },
  ],
};

// Stub templates — minimal placeholder content (2 areas x 4 questions/area) so
// the template-selection and multi-area UI flow works end-to-end. Flagged for
// real content later; not FR-M1-02 compliant (min. 5 areas x 12 Q) by design,
// per the agreed MVP scope (Digital Skills is the only fully-seeded template).
function stub(category: string, name: string, areas: Array<[string, string, string, string, string]>): SeedTemplate {
  return {
    category,
    name,
    areas: areas.map(([areaName, q1, q2, q3, q4]) => ({
      name: areaName,
      questions: [q1, q2, q3, q4].map((line, i) => {
        const [text, a, b, c, d, correct] = line.split('|');
        return { text, a, b, c, d, correct: correct as 'a' | 'b' | 'c' | 'd', type: i < 2 ? 'pre' : 'post' } as SeedQuestion;
      }),
    })),
  };
}

const financialLiteracy = stub('financial_literacy', 'Financial Literacy', [
  [
    'Budgeting Basics',
    'What is a budget?|A list of debts|A plan for how you will spend and save money|A bank statement|A loan agreement|b',
    'Why is tracking expenses useful?|It has no benefit|It helps you see where your money goes|It increases your income automatically|It replaces saving|b',
    'What is a fixed expense?|An expense that changes every month|A regular expense that stays the same each period, like rent|A one-time gift|Money you save|b',
    'What happens if your expenses exceed your income?|You save more|You go into deficit/debt|Nothing changes|Your income increases|b',
  ],
  [
    'Savings & Banking',
    'What is the purpose of a savings account?|To spend money quickly|To set aside money safely while it may earn interest|To avoid using banks|To pay bills only|b',
    'What is interest, in the context of savings?|A fee you always pay|Money earned on your saved balance over time|A type of loan|A banks logo|b',
    'What is an emergency fund?|Money set aside for unexpected expenses|A type of loan|A monthly subscription|A tax payment|a',
    'Why is comparing bank fees important before opening an account?|It is not important|Different accounts may have different costs that affect your savings|All banks charge the same fees always|Fees only apply to loans|b',
  ],
]);

const coding = stub('coding', 'Coding & Web Dev', [
  [
    'Programming Fundamentals',
    'What is a variable in programming?|A fixed value that never changes|A named storage location for a value that can change|A type of computer virus|A printer setting|b',
    'What does a "loop" allow a program to do?|Run a block of code repeatedly|Delete files|Connect to Wi-Fi|Change the screen resolution|a',
    'What is the purpose of an "if statement"?|To repeat code forever|To execute code conditionally based on a test|To store a password|To connect to a database|b',
    'What is a function in programming?|A reusable block of code that performs a task|A type of hardware|An internet browser|A file format|a',
  ],
  [
    'Web Basics',
    'What does HTML stand for?|HyperText Markup Language|High Tech Modern Language|Home Tool Markup Language|Hyperlink and Text Machine Language|a',
    'What is the role of CSS in a webpage?|Storing data in a database|Styling the appearance of a webpage|Running server logic|Sending emails|b',
    'What does a web browser do when you enter a URL?|Deletes your history|Requests and displays the webpage from a server|Formats your hard drive|Sends an email|b',
    'What is the purpose of JavaScript on a webpage?|To style text only|To add interactivity and dynamic behavior|To store files permanently|To print documents|b',
  ],
]);

const vocational = stub('vocational', 'Vocational & Trade', [
  [
    'Workplace Safety',
    'What is the purpose of personal protective equipment (PPE)?|To look professional|To reduce risk of injury on the job|To increase work speed|To replace training|b',
    'What should you do if you notice a safety hazard at work?|Ignore it|Report it to a supervisor promptly|Fix it yourself even without training|Wait for someone else to notice|b',
    'Why is proper training required before operating machinery?|It is not necessary|It reduces risk of accidents and improves safe operation|It slows down work unnecessarily|It is only for new employees|b',
    'What is the purpose of a workplace safety sign?|Decoration|To warn of hazards and required precautions|To advertise products|To show break times|b',
  ],
  [
    'Tools & Equipment',
    'Why is it important to maintain tools regularly?|It has no benefit|It ensures tools work safely and effectively|It voids the warranty always|It is only for expensive tools|b',
    'What should you check before using a piece of equipment?|Nothing, just start using it|That it is in good working condition and you are trained to use it|Only its color|Only its price|b',
    'What is the purpose of calibrating measurement tools?|To make them look new|To ensure accurate and reliable measurements|To increase their price|To change their color|b',
    'Why should tools be stored properly after use?|To prevent damage and ensure they are ready and safe for next use|It has no real purpose|Only to save space|Only required for expensive tools|a',
  ],
]);

const agricultural = stub('agricultural', 'Agricultural & Rural', [
  [
    'Crop & Soil Basics',
    'Why is soil testing useful before planting?|It has no benefit|It helps determine nutrient needs and suitability for crops|It replaces the need for water|It guarantees a harvest|b',
    'What is crop rotation?|Planting the same crop every season in the same field|Changing the type of crop grown in a field each season to maintain soil health|Harvesting crops at night|A type of fertilizer|b',
    'What is the purpose of irrigation?|To remove weeds|To supply water to crops when rainfall is insufficient|To harvest crops|To test soil pH|b',
    'Why is pest management important for crops?|It has no impact on yield|It helps protect crops from damage that reduces yield and quality|It only affects crop color|It replaces the need for soil nutrients|b',
  ],
  [
    'Farm Business Basics',
    'Why should a farmer keep records of expenses and sales?|It is not useful|To track profitability and make informed decisions|Only for tax purposes in some countries|It has no purpose|b',
    'What factor most directly affects the price a farmer receives for produce?|The farmers age|Market supply and demand|The farmers height|The color of the packaging only|b',
    'What is the benefit of joining a farmer cooperative?|No benefit|Shared resources, bargaining power, and market access|It requires giving up your farm|It only applies to livestock|b',
    'Why is post-harvest storage important?|It has no effect on produce|It reduces losses and preserves produce quality before sale|It only matters for grains|It increases pest damage intentionally|b',
  ],
]);

const creatorEconomy = stub('creator_economy', 'Creator Economy', [
  [
    'Content Creation Basics',
    'What is the purpose of a content calendar?|To delete old posts|To plan and schedule content in advance|To block followers|To change your username|b',
    'Why is video lighting important for content creators?|It has no effect on quality|Good lighting improves visual quality and viewer engagement|It only matters for photos|It replaces the need for a camera|b',
    'What does "editing" typically improve in a piece of content?|Nothing|Pacing, clarity, and overall quality|Only the file size|Only the title|b',
    'Why is consistency in posting schedule valuable for creators?|It has no impact|It helps build and retain an audience over time|It only matters for live streams|It reduces content quality|b',
  ],
  [
    'Audience & Monetization',
    'What does "engagement" measure on a content platform?|Server speed|How audiences interact with content, e.g. likes, comments, shares|Upload file size|Battery usage|b',
    'What is a common way creators monetize content?|Ignoring their audience|Sponsorships, ads, or selling products/services|Deleting all their content|Blocking all viewers|b',
    'Why is knowing your target audience important?|It has no impact|It helps tailor content that resonates and grows engagement|It only matters for large creators|It replaces the need for content quality|b',
    'What is a potential risk of relying on a single platform for income?|There is no risk|Platform changes or bans could significantly impact income|It guarantees stable income forever|It has no effect on strategy|b',
  ],
]);

export const TEMPLATES: SeedTemplate[] = [digitalSkills, financialLiteracy, coding, vocational, agricultural, creatorEconomy];
