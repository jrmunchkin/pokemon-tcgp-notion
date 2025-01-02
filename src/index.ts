import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { Client } from "@notionhq/client";

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_KEY });
const app: Express = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Static routes for media
const mediaRoutes = ["expansions", "packs", "types", "rarities", "cards"];
mediaRoutes.forEach((route) => {
  app.use(`/images-${route}`, express.static(path.join(__dirname, `medias/${route}`)));
});

// Static routes for assets zip
app.use(`/assets`, express.static(path.join(__dirname, `medias/assets.zip`)));

// Utility function to sync or prepare Notion data
async function prepareData(
  notion: any,
  notionClient: any,
  clientDB: string,
  originDB: string,
  mediaType: string,
  additionalProperties: (origin: any) => any = () => ({})
) {

  const [originItems, clientItems] = await Promise.all([
    notion.databases.query({ database_id: originDB }),
    notionClient.databases.query({ database_id: clientDB }),
  ]);

  const objectMap: Record<string, object> = {};

  for (const originItem of originItems.results) {
    const originName = originItem.properties.Name.title[0].text.content;
    console.log(clientItems);
    console.log(originName);
    const match = clientItems.results.find(
      (clientItem: any) => clientItem.properties.Name.title[0].text.content === originName
    );

    if (match) {
      objectMap[originItem.id] = {id: match.id, name: originName};
    } else {
      const newPage = await notionClient.pages.create({
        parent: { type: "database_id", database_id: clientDB },
        icon: {
          type: "external",
          external: { url: `${process.env.DOMAIN}/images-${mediaType}/${originName.replace(/ /g, '_')}.png` },
        },
        properties: {
          Name: { title: [{ text: { content: originName } }] },
          ...additionalProperties(originItem),
        },
      });
      objectMap[originItem.id] = {id: newPage.id, name: originName};
    }
  }

  return objectMap;
}

// Routes
app.get("/check", async (req: Request, res: Response) => {
  const syncItem: string = req.query.sync as string;

  const notionClient = new Client({ auth: req.query.secret as string });

  const myItemCards = await notion.databases.query({ database_id: process.env.DATABASE_CARD_ID! });
  const highestID = Math.max(
    ...myItemCards.results.map((c: any) => c.properties["Sync ID"]?.number || 0)
  );

  await notionClient.pages.update({
    page_id: syncItem,
    properties: { "Origin Max ID": { number: highestID } },
  });

  res.json("Sync checked");
});

app.get("/sync", async (req: Request, res: Response) => {
  const { secret, card, expansion, pack, type, rarity, sync, max_id } = req.query;
  const maxID = parseInt(max_id as string);
  
  const notionClient = new Client({ auth: secret as string });
  const prepare = prepareData.bind(null, notion, notionClient);

  const [types, rarities, expansions] = await Promise.all([
    prepare(type as string, process.env.DATABASE_TYPE_ID!, "types"),
    prepare(rarity as string, process.env.DATABASE_RARITY_ID!, "rarities"),
    prepare(expansion as string, process.env.DATABASE_EXPANSION_ID!, "expansions", (item: any) => ({
      "Released Date": { date: { start: item.properties["Released Date"].date.start } },
      Cover: {
        files: [{ name: item.properties.Name.title[0].text.content, external: { url: `${process.env.DOMAIN}/images-expansions/${item.properties.Name.title[0].text.content.replace(/ /g, '_')}.png` } }],
      },
    })),
  ]);

  const [packs] = await Promise.all([
    prepare(pack as string, process.env.DATABASE_PACK_ID!, "packs", (item: any) => ({
      Expansion: { relation: [{ id: expansions[item.properties.Expansion.relation[0].id].id }] },
    })),
  ]);
  
  const cards = await notion.databases.query({
    database_id: process.env.DATABASE_CARD_ID!,
    filter: { property: "Sync ID", number: { greater_than: maxID } },
    sorts: [
	    {
	      property: "Sync ID",
	      direction: "ascending"
		  }
	  ],
  });

  var nbCardSynced = 0;
  for (const cardItem of cards.results as any[]) {

    if(nbCardSynced >= parseInt(process.env.LIMIT)){
      break;
    }

    const properties = cardItem.properties;

    const data: any = {
      parent: { type: "database_id", database_id: card as string },
      properties: {
        Name: { title: [{ text: { content: properties.Name.title[0].text.content } }] },
        "Card ID": { number: properties["Card ID"].number },
        "Sync ID": { number: properties["Sync ID"].number },
        HP: { number: properties.HP.number },
        Type: { relation: [{ id: types[properties.Type.relation[0].id].id }] },
        Rarity: { relation: [{ id: rarities[properties.Rarity.relation[0].id].id }] },
        Expansion: { relation: [{ id: expansions[properties.Expansion.relation[0].id].id }] },
        Packs: {
          relation: properties.Packs.relation.map((pack: any) => ({ id: packs[pack.id].id })),
        },
        Sync: { relation: [{ id: sync as string }] },
        Illustration: {
          rich_text: [{ type: "text", text: { content: properties.Illustration.rich_text[0].text.content }, annotations: { bold: true } }],
        },
        Cover: {
          files: [{ name: properties.Name.title[0].text.content, external: { url: `${process.env.DOMAIN}/images-cards/${properties["Sync ID"].number}.webp` } }],
        },
        "Rarity Display": {
          files: [{ name: rarities[properties.Rarity.relation[0].id].name, external: { url: `${process.env.DOMAIN}/images-rarities/${rarities[properties.Rarity.relation[0].id].name.replace(/ /g, '_')}_display.png` }}],
        },
      },
      children: createChildren(properties),
    };

    console.log(`Adding ${properties.Name.title[0].text.content} to Notion`);
    await notionClient.pages.create(data);
    nbCardSynced++;
  }

  res.json("Sync ok");
});

// Helper function for children blocks
function createChildren(properties: any) {
  const children: any = [
    {
      object: "block",
      type: "image",
      image: { type: "external", external: { url: `${process.env.DOMAIN}/images-cards/${properties["Sync ID"].number}.webp` } },
    },
  ];

  if (properties["Flavor"]?.rich_text?.[0]?.text?.content) {
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
