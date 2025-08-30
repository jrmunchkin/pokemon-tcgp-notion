import axios from 'axios';
import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Charger les variables d'environnement
dotenv.config();

// Configuration des variables d'environnement
const TCG_SET_ID = process.env.TCG_SET_ID;
const TCG_START_NUMBER = parseInt(process.env.TCG_START_NUMBER);
const TCG_END_NUMBER = parseInt(process.env.TCG_END_NUMBER);
const NOTION_KEY = process.env.NOTION_KEY;
const DATABASE_CARD_ID = process.env.DATABASE_CARD_ID;
const DEFAULT_PACK = process.env.DEFAULT_PACK;
const SYNC_START_ID = parseInt(process.env.SYNC_START_ID);

// IDs des bases de données de relations
const DATABASE_RARITY_ID = process.env.DATABASE_RARITY_ID;
const DATABASE_TYPE_ID = process.env.DATABASE_TYPE_ID;
const DATABASE_EXPANSION_ID = process.env.DATABASE_EXPANSION_ID;
const DATABASE_PACK_ID = process.env.DATABASE_PACK_ID;

// Initialiser le client Notion
const notion = new Client({
  auth: NOTION_KEY,
});

// Mapping des rarités de l'API vers Notion
const rarityMapping: { [key: string]: string } = {
  'One Diamond': 'Common',
  'Two Diamond': 'Uncommon',
  'Three Diamond': 'Rare',
  'Four Diamond': 'Double Rare',
  'One Star': 'Art Rare',
  'Two Star': 'Special Art Rare',
  'Three Star': 'Immersive Rare',
  'One Shiny': 'Shiny Rare',
  'Two Shiny': 'Double Shiny Rare',
  'Crown': 'Crown Rare',
};

// Interface pour les données de carte (seulement les propriétés utilisées)
interface TCGCard {
  id: string;
  illustrator: string;
  image: string;
  localId: string;
  name: string;
  rarity: string;
  set: {
    name: string;
  };
  hp?: number;
  types?: string[];
  description?: string;
  boosters: Array<{
    name: string;
  }>;
}

// Fonction pour récupérer les UUIDs des bases de données de relations
async function getRelationUUIDs() {
  const uuids: { [key: string]: { [key: string]: string } } = {
    rarities: {},
    types: {},
    expansions: {},
    packs: {}
  };

  try {
    // Récupérer les rarités
    const raritiesResponse = await notion.databases.query({
      database_id: DATABASE_RARITY_ID,
    });
    raritiesResponse.results.forEach((page: any) => {
      const name = page.properties.Name?.title?.[0]?.text?.content;
      if (name) uuids.rarities[name] = page.id;
    });

    // Récupérer les types
    const typesResponse = await notion.databases.query({
      database_id: DATABASE_TYPE_ID,
    });
    typesResponse.results.forEach((page: any) => {
      const name = page.properties.Name?.title?.[0]?.text?.content;
      if (name) uuids.types[name] = page.id;
    });

    // Récupérer les expansions
    const expansionsResponse = await notion.databases.query({
      database_id: DATABASE_EXPANSION_ID,
    });
    expansionsResponse.results.forEach((page: any) => {
      const name = page.properties.Name?.title?.[0]?.text?.content;
      if (name) uuids.expansions[name] = page.id;
    });

    // Récupérer les packs
    const packsResponse = await notion.databases.query({
      database_id: DATABASE_PACK_ID,
    });
    packsResponse.results.forEach((page: any) => {
      const name = page.properties.Name?.title?.[0]?.text?.content;
      if (name) uuids.packs[name] = page.id;
    });

    console.log('📋 UUIDs récupérés:', {
      rarities: Object.keys(uuids.rarities).length,
      types: Object.keys(uuids.types).length,
      expansions: Object.keys(uuids.expansions).length,
      packs: Object.keys(uuids.packs).length
    });

    return uuids;
  } catch (error) {
    console.error('❌ Erreur récupération UUIDs:', error);
    return uuids;
  }
}

// Fonction pour télécharger une image
async function downloadCardImage(imageUrl: string, syncId: number): Promise<string | null> {
  try {
    const fullImageUrl = `${imageUrl}/high.webp`;
    const response = await axios.get(fullImageUrl, { responseType: 'arraybuffer' });
    
    const cardsDir = path.join(__dirname, 'medias', 'cards');
    if (!fs.existsSync(cardsDir)) {
      fs.mkdirSync(cardsDir, { recursive: true });
    }
    
    const fileName = `${syncId}.webp`;
    const filePath = path.join(cardsDir, fileName);
    
    fs.writeFileSync(filePath, response.data);
    
    console.log(`📸 Image téléchargée: ${fileName}`);
    return fileName;
  } catch (error) {
    console.error(`❌ Erreur téléchargement image pour syncId ${syncId}:`, error);
    return null;
  }
}

// Fonction pour récupérer une carte depuis l'API avec retry
async function fetchCard(setId: string, cardNumber: number, retries = 3): Promise<TCGCard | null> {
  const paddedNumber = cardNumber.toString().padStart(3, '0');
  const url = `https://api.tcgdex.net/v2/en/cards/${setId}-${paddedNumber}`;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Fetching card: ${url} (attempt ${attempt}/${retries})`);
      
      const response = await axios.get<TCGCard>(url, {
        timeout: 10000, // 10 secondes de timeout
        headers: {
          'User-Agent': 'TCG-Fetcher/1.0'
        }
      });
      
      return response.data;
    } catch (error: any) {
      if (attempt === retries) {
        console.error(`❌ Error fetching card ${setId}-${paddedNumber} after ${retries} attempts:`, error.message);
        return null;
      }
      
      console.log(`⚠️ Attempt ${attempt} failed for ${setId}-${paddedNumber}, retrying in ${attempt * 2} seconds...`);
      await new Promise(resolve => setTimeout(resolve, attempt * 2000)); // Délai progressif
    }
  }
  
  return null;
}

// Fonction pour insérer une carte dans Notion
async function insertCardToNotion(card: TCGCard, syncId: number, uuids: any): Promise<void> {
  await downloadCardImage(card.image, syncId);
  
  try {
    await notion.pages.create({
      parent: {
        database_id: DATABASE_CARD_ID,
      },
      properties: {
        'Name': {
          title: [{ text: { content: card.name } }],
        },
        'Card ID': {
          number: parseInt(card.localId),
        },
        'Rarity': {
          relation: uuids.rarities[rarityMapping[card.rarity] || card.rarity] 
            ? [{ id: uuids.rarities[rarityMapping[card.rarity] || card.rarity] }] 
            : [],
        },
        'Expansion': {
          relation: uuids.expansions[card.set.name] 
            ? [{ id: uuids.expansions[card.set.name] }] 
            : [],
        },
        'HP': {
          number: card.hp || null,
        },
        'Type': {
          relation: card.types?.filter(type => uuids.types[type]).map(type => ({ id: uuids.types[type] })) || [],
        },
        'Flavor': {
          rich_text: [{ text: { content: card.description || '' } }],
        },
        'Illustration': {
          rich_text: [{ 
            text: { 
              content: card.illustrator || '',
              link: null
            },
            annotations: {
              bold: true,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: 'default'
            }
          }],
        },
        'Packs': {
          relation: card.boosters && card.boosters.length > 0 
            ? card.boosters.filter(booster => uuids.packs[booster.name]).map(booster => ({ id: uuids.packs[booster.name] }))
            : DEFAULT_PACK && uuids.packs[DEFAULT_PACK] ? [{ id: uuids.packs[DEFAULT_PACK] }] : [],
        },
        'Sync ID': {
          number: syncId,
        },
      },
    });

    console.log(`✅ Card ${card.name} (${card.id}) inserted to Notion`);
  } catch (error) {
    console.error(`❌ Error inserting card ${card.name} to Notion:`, error);
  }
}

// Fonction principale
async function main() {
  console.log('🚀 Starting TCG Dex to Notion sync...');
  console.log(`Set ID: ${TCG_SET_ID}`);
  console.log(`Range: ${TCG_START_NUMBER} - ${TCG_END_NUMBER}`);
  
  if (!NOTION_KEY) {
    console.error('❌ NOTION_KEY environment variable is required');
    process.exit(1);
  }

  let successCount = 0;
  let errorCount = 0;
  let currentSyncId = SYNC_START_ID;

  // Récupérer les UUIDs des relations
  console.log('🔍 Récupération des UUIDs des relations...');
  const uuids = await getRelationUUIDs();

  for (let cardNumber = TCG_START_NUMBER; cardNumber <= TCG_END_NUMBER; cardNumber++) {
    try {
      const card = await fetchCard(TCG_SET_ID, cardNumber);
      
      if (card) {
        await insertCardToNotion(card, currentSyncId, uuids);
        currentSyncId++;
        successCount++;
      } else {
        errorCount++;
      }

      await new Promise(resolve => setTimeout(resolve, 2000)); // Augmenté à 2 secondes
      
    } catch (error) {
      console.error(`❌ Error processing card ${cardNumber}:`, error);
      errorCount++;
    }
  }

  console.log('\n📊 Sync completed!');
  console.log(`✅ Successfully processed: ${successCount} cards`);
  console.log(`❌ Errors: ${errorCount} cards`);
}

// Gestion des erreurs non capturées
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Lancer le script
if (require.main === module) {
  main().catch(console.error);
}

export { main, fetchCard, insertCardToNotion };
