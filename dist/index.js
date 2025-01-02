"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@notionhq/client");
dotenv_1.default.config();
const notion = new client_1.Client({ auth: process.env.NOTION_KEY });
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "10mb" }));
// Static routes for media
const mediaRoutes = ["expansions", "packs", "types", "rarities", "cards"];
mediaRoutes.forEach((route) => {
    app.use(`/images-${route}`, express_1.default.static(path_1.default.join(__dirname, `medias/${route}`)));
});
// Static routes for assets zip
app.use(`/assets`, express_1.default.static(path_1.default.join(__dirname, `medias/assets.zip`)));
// Utility function to sync or prepare Notion data
function prepareData(notion, notionClient, clientDB, originDB, mediaType, additionalProperties = () => ({})) {
    return __awaiter(this, void 0, void 0, function* () {
        const [originItems, clientItems] = yield Promise.all([
            notion.databases.query({ database_id: originDB }),
            notionClient.databases.query({ database_id: clientDB }),
        ]);
        const objectMap = {};
        for (const originItem of originItems.results) {
            const originName = originItem.properties.Name.title[0].text.content;
            console.log(clientItems);
            const match = clientItems.results.find((clientItem) => clientItem.properties.Name.title[0].text.content === originName);
            if (match) {
                objectMap[originItem.id] = { id: match.id, name: originName };
            }
            else {
                const newPage = yield notionClient.pages.create({
                    parent: { type: "database_id", database_id: clientDB },
                    icon: {
                        type: "external",
                        external: { url: `${process.env.DOMAIN}/images-${mediaType}/${originName.replace(/ /g, '_')}.png` },
                    },
                    properties: Object.assign({ Name: { title: [{ text: { content: originName } }] } }, additionalProperties(originItem)),
                });
                objectMap[originItem.id] = { id: newPage.id, name: originName };
            }
        }
        return objectMap;
    });
}
// Routes
app.get("/check", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const syncItem = req.query.sync;
    const notionClient = new client_1.Client({ auth: req.query.secret });
    const myItemCards = yield notion.databases.query({ database_id: process.env.DATABASE_CARD_ID });
    const highestID = Math.max(...myItemCards.results.map((c) => { var _a; return ((_a = c.properties["Sync ID"]) === null || _a === void 0 ? void 0 : _a.number) || 0; }));
    yield notionClient.pages.update({
        page_id: syncItem,
        properties: { "Origin Max ID": { number: highestID } },
    });
    res.json("Sync checked");
}));
app.get("/sync", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { secret, card, expansion, pack, type, rarity, sync, max_id } = req.query;
    const maxID = parseInt(max_id);
    const notionClient = new client_1.Client({ auth: secret });
    const prepare = prepareData.bind(null, notion, notionClient);
    const [types, rarities, expansions] = yield Promise.all([
        prepare(type, process.env.DATABASE_TYPE_ID, "types"),
        prepare(rarity, process.env.DATABASE_RARITY_ID, "rarities"),
        prepare(expansion, process.env.DATABASE_EXPANSION_ID, "expansions", (item) => ({
            "Released Date": { date: { start: item.properties["Released Date"].date.start } },
            Cover: {
                files: [{ name: item.properties.Name.title[0].text.content, external: { url: `${process.env.DOMAIN}/images-expansions/${item.properties.Name.title[0].text.content.replace(/ /g, '_')}.png` } }],
            },
        })),
    ]);
    const [packs] = yield Promise.all([
        prepare(pack, process.env.DATABASE_PACK_ID, "packs", (item) => ({
            Expansion: { relation: [{ id: expansions[item.properties.Expansion.relation[0].id].id }] },
        })),
    ]);
    const cards = yield notion.databases.query({
        database_id: process.env.DATABASE_CARD_ID,
        filter: { property: "Sync ID", number: { greater_than: maxID } },
        sorts: [
            {
                property: "Sync ID",
                direction: "ascending"
            }
        ],
    });
    var nbCardSynced = 0;
    for (const cardItem of cards.results) {
        if (nbCardSynced >= parseInt(process.env.LIMIT)) {
            break;
        }
        const properties = cardItem.properties;
        const data = {
            parent: { type: "database_id", database_id: card },
            properties: {
                Name: { title: [{ text: { content: properties.Name.title[0].text.content } }] },
                "Card ID": { number: properties["Card ID"].number },
                "Sync ID": { number: properties["Sync ID"].number },
                HP: { number: properties.HP.number },
                Type: { relation: [{ id: types[properties.Type.relation[0].id].id }] },
                Rarity: { relation: [{ id: rarities[properties.Rarity.relation[0].id].id }] },
                Expansion: { relation: [{ id: expansions[properties.Expansion.relation[0].id].id }] },
                Packs: {
                    relation: properties.Packs.relation.map((pack) => ({ id: packs[pack.id].id })),
                },
                Sync: { relation: [{ id: sync }] },
                Illustration: {
                    rich_text: [{ type: "text", text: { content: properties.Illustration.rich_text[0].text.content }, annotations: { bold: true } }],
                },
                Cover: {
                    files: [{ name: properties.Name.title[0].text.content, external: { url: `${process.env.DOMAIN}/images-cards/${properties["Sync ID"].number}.webp` } }],
                },
                "Rarity Display": {
                    files: [{ name: rarities[properties.Rarity.relation[0].id].name, external: { url: `${process.env.DOMAIN}/images-rarities/${rarities[properties.Rarity.relation[0].id].name.replace(/ /g, '_')}_display.png` } }],
                },
            },
            children: createChildren(properties),
        };
        console.log(`Adding ${properties.Name.title[0].text.content} to Notion`);
        yield notionClient.pages.create(data);
        nbCardSynced++;
    }
    res.json("Sync ok");
}));
// Helper function for children blocks
function createChildren(properties) {
    var _a, _b, _c, _d;
    const children = [
        {
            object: "block",
            type: "image",
            image: { type: "external", external: { url: `${process.env.DOMAIN}/images-cards/${properties["Sync ID"].number}.webp` } },
        },
    ];
    if ((_d = (_c = (_b = (_a = properties["Flavor"]) === null || _a === void 0 ? void 0 : _a.rich_text) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.text) === null || _d === void 0 ? void 0 : _d.content) {
        children.push({
            object: "block",
            type: "quote",
            quote: { rich_text: [{ text: { content: properties["Flavor"].rich_text[0].text.content }, annotations: { italic: true } }] },
        });
    }
    return children;
}
app.listen(PORT, () => {
    console.log(`🚀 Server ready at http://localhost:${PORT}`);
});
//# sourceMappingURL=index.js.map