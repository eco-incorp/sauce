<!-- Generated from the SDK's registries. Do not edit. -->

# Stock tokens

A tokenized stock is a token like any other: a program compiled for its chain names it by its
symbol with no import (`SPCXc.balanceOf(ctx.self())` on Base), and amounts are in its smallest
units (its decimals). The symbol is the issuer's own ticker for the token, with a `.` written
`_` (`BRK.Bx` is `BRK_Bx`). Their addresses are in the chain's stocks file in `sauce-chains`.

Any contract can hold, receive and send them, a program's Pot included; an issuer can pause its
token or refuse a sanctioned address. Backed's (its xStocks, and bTokens such as `bTSLA`)
rebase: a balance can change between transactions, never within one, and a transfer can credit
one unit less than sent, so paying one into a pool that checks what it received can fail (buying
one is unaffected). Coinbase's are B20 tokens, built into the Base node: they run on Base, and
not in a local copy of the chain. The rest is in the skill's
[Tokenized stocks](../SKILL.md#tokenized-stocks).

## Ethereum (`ethereum`, [addresses](../../sauce-chains/references/ethereum-stocks.md))

| Symbol | Token | Ticker | Issuer | Decimals |
| --- | --- | --- | --- | --- |
| `A5Gx` | AIB xStock | A5GI | Backed | 18 |
| `AAFx` | Airtel Africa xStock | AAFL | Backed | 18 |
| `AALon` | American Airlines Group (Ondo Tokenized) | AAL | Ondo Global Markets | 18 |
| `AALx` | American Airlines xStock | AAL | Backed | 18 |
| `AAOIon` | Applied Optoelectronics (Ondo Tokenized) | AAOI | Ondo Global Markets | 18 |
| `AAOIx` | Applied Optoelectronics xStock | AAOI | Backed | 18 |
| `AAONon` | AAON (Ondo Tokenized) | AAON | Ondo Global Markets | 18 |
| `AAONx` | AAON xStock | AAON | Backed | 18 |
| `AAPLon` | Apple (Ondo Tokenized) | AAPL | Ondo Global Markets | 18 |
| `AAPLx` | Apple xStock | AAPL | Backed | 18 |
| `AAx` | Alcoa xStock | AA | Backed | 18 |
| `ABBVon` | AbbVie (Ondo Tokenized) | ABBV | Ondo Global Markets | 18 |
| `ABBVx` | AbbVie xStock | ABBV | Backed | 18 |
| `ABDNx` | Aberdeen xStock | ABDNL | Backed | 18 |
| `ABFx` | Associated British Foods xStock | ABFL | Backed | 18 |
| `ABI_BEx` | Anheuser-Busch InBev SA/NV xStock | ABIB | Backed | 18 |
| `ABNBon` | Airbnb (Ondo Tokenized) | ABNB | Ondo Global Markets | 18 |
| `ABNBx` | Airbnb xStock | ABNB | Backed | 18 |
| `ABNx` | ABN AMRO Bank xStock | ABNA | Backed | 18 |
| `ABTon` | Abbott (Ondo Tokenized) | ABT | Ondo Global Markets | 18 |
| `ABTx` | Abbott xStock | ABT | Backed | 18 |
| `ACA_FRx` | Credit Agricole xStock | ACAP | Backed | 18 |
| `ACHRon` | Archer Aviation (Ondo Tokenized) | ACHR | Ondo Global Markets | 18 |
| `ACIx` | Albertsons Companies xStock | ACI | Backed | 18 |
| `ACLSon` | Axcelis Technologies (Ondo Tokenized) | ACLS | Ondo Global Markets | 18 |
| `ACMRon` | ACM Research (Ondo Tokenized) | ACMR | Ondo Global Markets | 18 |
| `ACMx` | Aecom xStock | ACM | Backed | 18 |
| `ACNon` | Accenture (Ondo Tokenized) | ACN | Ondo Global Markets | 18 |
| `ACNx` | Accenture xStock | ACN | Backed | 18 |
| `ADBEon` | Adobe (Ondo Tokenized) | ADBE | Ondo Global Markets | 18 |
| `ADBEx` | Adobe xStock | ADBE | Backed | 18 |
| `ADCx` | Agree Realty xStock | ADC | Backed | 18 |
| `ADIon` | Analog Devices (Ondo Tokenized) | ADI | Ondo Global Markets | 18 |
| `ADIx` | Analog Devices xStock | ADI | Backed | 18 |
| `ADM_GBx` | Admiral xStock | ADML | Backed | 18 |
| `ADMx` | Archer-Daniels-Midland xStock | ADM | Backed | 18 |
| `ADPx` | Automatic Data Processing xStock | ADP | Backed | 18 |
| `ADSKx` | Autodesk xStock | ADSK | Backed | 18 |
| `ADSx` | adidas xStock | ADSD | Backed | 18 |
| `ADTx` | ADT xStock | ADT | Backed | 18 |
| `ADYENx` | Adyen xStock | ADYENA | Backed | 18 |
| `AD_NLx` | Koninklijke Ahold Delhaize xStock | ADA | Backed | 18 |
| `AEEx` | Ameren xStock | AEE | Backed | 18 |
| `AEHRon` | Aehr Test Systems (Ondo Tokenized) | AEHR | Ondo Global Markets | 18 |
| `AEHRx` | Aehr Test Systems xStock | AEHR | Backed | 18 |
| `AEISx` | Advanced Energy Industries xStock | AEIS | Backed | 18 |
| `AENAx` | Aena SME xStock | AENAE | Backed | 18 |
| `AEPx` | American Electric Power xStock | AEP | Backed | 18 |
| `AFGx` | American Financial xStock | AFG | Backed | 18 |
| `AFLx` | Aflac xStock | AFL | Backed | 18 |
| `AFRMx` | Affirm xStock | AFRM | Backed | 18 |
| `AGCOx` | AGCO xStock | AGCO | Backed | 18 |
| `AGGon` | iShares Core US Aggregate Bond ETF (Ondo Tokenized) | AGG | Ondo Global Markets | 18 |
| `AGNCx` | AGNC Investment xStock | AGNC | Backed | 18 |
| `AGon` | First Majestic Silver (Ondo Tokenized) | AG | Ondo Global Markets | 18 |
| `AHRx` | American Healthcare REIT xStock | AHR | Backed | 18 |
| `AIAGRx` | AIA xStock | 1299 | Backed | 18 |
| `AIGx` | American International xStock | AIG | Backed | 18 |
| `AIPon` | Arteris (Ondo Tokenized) | AIP | Ondo Global Markets | 18 |
| `AIQon` | Global X Artificial Intelligence & Technology ETF (Ondo Tokenized) | AIQ | Ondo Global Markets | 18 |
| `AIR_FRx` | Airbus xStock | AIRP | Backed | 18 |
| `AITx` | Applied Industrial Technologies xStock | AIT | Backed | 18 |
| `AIZx` | Assurant xStock | AIZ | Backed | 18 |
| `AI_FRx` | Air Liquide xStock | AIP | Backed | 18 |
| `AIon` | C3.ai (Ondo Tokenized) | AI | Ondo Global Markets | 18 |
| `AIx` | C3.ai xStock | AI | Backed | 18 |
| `AJBx` | AJ Bell xStock | AJBL | Backed | 18 |
| `AJGx` | Arthur J. Gallagher xStock | AJG | Backed | 18 |
| `AKAMx` | Akamai Technologies xStock | AKAM | Backed | 18 |
| `ALABon` | Astera Labs (Ondo Tokenized) | ALAB | Ondo Global Markets | 18 |
| `ALABx` | Astera Labs xStock | ALAB | Backed | 18 |
| `ALBon` | Albemarle (Ondo Tokenized) | ALB | Ondo Global Markets | 18 |
| `ALBx` | Albemarle xStock | ALB | Backed | 18 |
| `ALGMx` | Allegro Microsystems xStock | ALGM | Backed | 18 |
| `ALGNx` | Align Technology xStock | ALGN | Backed | 18 |
| `ALLYx` | Ally Financial xStock | ALLY | Backed | 18 |
| `ALLx` | Allstate xStock | ALL | Backed | 18 |
| `ALMx` | Almonty Industries xStock | ALM | Backed | 18 |
| `ALNYx` | Alnylam Pharmaceuticals xStock | ALNY | Backed | 18 |
| `ALOYon` | REalloys (Ondo Tokenized) | ALOY | Ondo Global Markets | 18 |
| `ALSNx` | Allison Transmission xStock | ALSN | Backed | 18 |
| `ALV_DEx` | Allianz xStock | ALVD | Backed | 18 |
| `AMATon` | Applied Materials (Ondo Tokenized) | AMAT | Ondo Global Markets | 18 |
| `AMATx` | Applied Materials, Inc. xStock | AMAT | Backed | 18 |
| `AMBRx` | Amber xStock | AMBR | Backed | 18 |
| `AMCon` | AMC Entertainment (Ondo Tokenized) | AMC | Ondo Global Markets | 18 |
| `AMCx` | AMC Entertainment xStock | AMC | Backed | 18 |
| `AMDon` | AMD (Ondo Tokenized) | AMD | Ondo Global Markets | 18 |
| `AMDx` | AMD xStock | AMD | Backed | 18 |
| `AMEon` | AMETEK (Ondo Tokenized) | AME | Ondo Global Markets | 18 |
| `AMEx` | AMETEK xStock | AME | Backed | 18 |
| `AMGNon` | Amgen (Ondo Tokenized) | AMGN | Ondo Global Markets | 18 |
| `AMGNx` | Amgen xStock | AMGN | Backed | 18 |
| `AMGx` | Affiliated Managers xStock | AMG | Backed | 18 |
| `AMHx` | American Homes 4 Rent xStock | AMH | Backed | 18 |
| `AMKRon` | Amkor Technology (Ondo Tokenized) | AMKR | Ondo Global Markets | 18 |
| `AMKRx` | Amkor Technology xStock | AMKR | Backed | 18 |
| `AMPx` | Ameriprise Financial xStock | AMP | Backed | 18 |
| `AMS_ESx` | Amadeus IT xStock | AMSE | Backed | 18 |
| `AMTMx` | Amentum xStock | AMTM | Backed | 18 |
| `AMTx` | American Tower xStock | AMT | Backed | 18 |
| `AMZNon` | Amazon (Ondo Tokenized) | AMZN | Ondo Global Markets | 18 |
| `AMZNx` | Amazon.com xStock | AMZN | Backed | 18 |
| `AMx` | Antero Midstream xStock | AM | Backed | 18 |
| `ANETon` | Arista Networks (Ondo Tokenized) | ANET | Ondo Global Markets | 18 |
| `ANETx` | Arista Networks, Inc. xStock | ANET | Backed | 18 |
| `ANTASx` | ANTA Sports Products xStock | 2020 | Backed | 18 |
| `ANTOx` | Antofagasta xStock | ANTOL | Backed | 18 |
| `AOSLon` | Alpha and Omega Semiconductor (Ondo Tokenized) | AOSL | Ondo Global Markets | 18 |
| `AOSx` | A.O. Smith xStock | AOS | Backed | 18 |
| `APAx` | APA xStock | APA | Backed | 18 |
| `APDx` | Air Products and Chemicals xStock | APD | Backed | 18 |
| `APGx` | APi xStock | APG | Backed | 18 |
| `APHon` | Amphenol (Ondo Tokenized) | APH | Ondo Global Markets | 18 |
| `APHx` | Amphenol xStock | APH | Backed | 18 |
| `APLDon` | Applied Digital (Ondo Tokenized) | APLD | Ondo Global Markets | 18 |
| `APLDx` | Applied Digital Corporation xStock | APLD | Backed | 18 |
| `APOon` | Apollo Global Management (Ondo Tokenized) | APO | Ondo Global Markets | 18 |
| `APOx` | Apollo Global Management xStock | APO | Backed | 18 |
| `APPFx` | AppFolio xStock | APPF | Backed | 18 |
| `APPon` | AppLovin (Ondo Tokenized) | APP | Ondo Global Markets | 18 |
| `APPx` | AppLovin xStock | APP | Backed | 18 |
| `ARESx` | Ares Management xStock | ARES | Backed | 18 |
| `AREx` | Alexandria Real Estate Equities xStock | ARE | Backed | 18 |
| `ARGTon` | Global X MSCI Argentina ETF (Ondo Tokenized) | ARGT | Ondo Global Markets | 18 |
| `ARMKx` | Aramark xStock | ARMK | Backed | 18 |
| `ARMon` | Arm Holdings plc (Ondo Tokenized) | ARM | Ondo Global Markets | 18 |
| `ARMx` | ARM xStock | ARM | Backed | 18 |
| `ARQQon` | Arqit Quantum (Ondo Tokenized) | ARQQ | Ondo Global Markets | 18 |
| `ARWRx` | Arrowhead Pharmaceuticals xStock | ARWR | Backed | 18 |
| `ARWx` | Arrow Electronics xStock | ARW | Backed | 18 |
| `ARx` | Antero Resources xStock | AR | Backed | 18 |
| `ASMLon` | ASML Holding NV (Ondo Tokenized) | ASML | Ondo Global Markets | 18 |
| `ASMLx` | ASML xStock | ASML | Backed | 18 |
| `ASMPTx` | ASMPT xStock | 522 | Backed | 18 |
| `ASM_NLx` | ASM International xStock | ASMA | Backed | 18 |
| `ASTSon` | AST SpaceMobile (Ondo Tokenized) | ASTS | Ondo Global Markets | 18 |
| `ASTSx` | AST SpaceMobile xStock | ASTS | Backed | 18 |
| `ASx` | Amer Sports xStock | AS | Backed | 18 |
| `ATIx` | ATI xStock | ATI | Backed | 18 |
| `ATKRon` | Atkore (Ondo Tokenized) | ATKR | Ondo Global Markets | 18 |
| `ATOx` | Atmos Energy xStock | ATO | Backed | 18 |
| `ATRx` | AptarGroup xStock | ATR | Backed | 18 |
| `AUGOx` | Aura Minerals xStock | AUGO | Backed | 18 |
| `AURon` | Aurora Innovation (Ondo Tokenized) | AUR | Ondo Global Markets | 18 |
| `AURx` | Aurora Innovation xStock | AUR | Backed | 18 |
| `AUTO_GBx` | Auto Trader xStock | AUTOL | Backed | 18 |
| `AVAVx` | AeroVironment xStock | AVAV | Backed | 18 |
| `AVGOon` | Broadcom (Ondo Tokenized) | AVGO | Ondo Global Markets | 18 |
| `AVGOx` | Broadcom xStock | AVGO | Backed | 18 |
| `AVTRx` | Avantor xStock | AVTR | Backed | 18 |
| `AVTx` | Avnet xStock | AVT | Backed | 18 |
| `AVYx` | Avery Dennison xStock | AVY | Backed | 18 |
| `AV_GBx` | Aviva xStock | AVL | Backed | 18 |
| `AWIx` | Armstrong World Industries xStock | AWI | Backed | 18 |
| `AWKx` | American Water Works xStock | AWK | Backed | 18 |
| `AXONx` | Axon Enterprise xStock | AXON | Backed | 18 |
| `AXPon` | American Express (Ondo Tokenized) | AXP | Ondo Global Markets | 18 |
| `AXSMx` | Axsome Therapeutics xStock | AXSM | Backed | 18 |
| `AXSx` | Axis Capital xStock | AXS | Backed | 18 |
| `AXTAx` | Axalta Coating Systems xStock | AXTA | Backed | 18 |
| `AXTIon` | AXT (Ondo Tokenized) | AXTI | Ondo Global Markets | 18 |
| `AXTIx` | AXT xStock | AXTI | Backed | 18 |
| `AYIx` | Acuity xStock | AYI | Backed | 18 |
| `AZNx` | AstraZeneca xStock | AZN | Backed | 18 |
| `AZOx` | AutoZone xStock | AZO | Backed | 18 |
| `Ax` | Agilent Technologies xStock | A | Backed | 18 |
| `BABAon` | Alibaba (Ondo Tokenized) | BABA | Ondo Global Markets | 18 |
| `BABAx` | Alibaba xStock | BABA | Backed | 18 |
| `BAB_GBx` | Babcock International xStock | BABL | Backed | 18 |
| `BACon` | Bank of America (Ondo Tokenized) | BAC | Ondo Global Markets | 18 |
| `BACx` | Bank of America xStock | BAC | Backed | 18 |
| `BAHx` | Booz Allen Hamilton xStock | BAH | Backed | 18 |
| `BAIon` | iShares A.I. Innovation and Tech Active ETF (Ondo Tokenized) | BAI | Ondo Global Markets | 18 |
| `BALLx` | Ball xStock | BALL | Backed | 18 |
| `BAMIx` | Banco BPM xStock | BAMIM | Backed | 18 |
| `BAMx` | Brookfield Asset Management xStock | BAM | Backed | 18 |
| `BANKCx` | Bank Of China xStock | 3988 | Backed | 18 |
| `BARCx` | Barclays xStock | BARCL | Backed | 18 |
| `BASx` | Basf xStock | BASD | Backed | 18 |
| `BATSx` | British American Tobacco xStock | BATSL | Backed | 18 |
| `BAXx` | Baxter International xStock | BAX | Backed | 18 |
| `BAYNx` | Bayer xStock | BAYND | Backed | 18 |
| `BA_GBx` | BAE Systems xStock | BAL | Backed | 18 |
| `BAon` | Boeing (Ondo Tokenized) | BA | Ondo Global Markets | 18 |
| `BAx` | Boeing xStock | BA | Backed | 18 |
| `BBAIon` | BigBear.ai Holdings (Ondo Tokenized) | BBAI | Ondo Global Markets | 18 |
| `BBIOx` | BridgeBio Pharma xStock | BBIO | Backed | 18 |
| `BBVAx` | Banco Bilbao Vizcaya Argentaria xStock | BBVAE | Backed | 18 |
| `BBY_GBx` | Balfour Beatty xStock | BBYL | Backed | 18 |
| `BBYx` | Best Buy xStock | BBY | Backed | 18 |
| `BBx` | BlackBerry xStock | BB | Backed | 18 |
| `BCx` | Brunswick xStock | BC | Backed | 18 |
| `BDWAPx` | Budweiser Brewing Co APAC xStock | 1876 | Backed | 18 |
| `BDXx` | Becton Dickinson xStock | BDX | Backed | 18 |
| `BENx` | Franklin Templeton xStock | BEN | Backed | 18 |
| `BEPCx` | Brookfield Renewable xStock | BEPC | Backed | 18 |
| `BETRx` | Better Home & Finance xStock | BETR | Backed | 18 |
| `BEZ_GBx` | Beazley xStock | BEZL | Backed | 18 |
| `BEon` | Bloom Energy (Ondo Tokenized) | BE | Ondo Global Markets | 18 |
| `BEx` | Bloom Energy xStock | BE | Backed | 18 |
| `BGEOx` | Lion Finance xStock | BGEOL | Backed | 18 |
| `BIDUon` | Baidu (Ondo Tokenized) | BIDU | Ondo Global Markets | 18 |
| `BIDUx` | Baidu xStock | BIDU | Backed | 18 |
| `BIIBx` | Biogen xStock | BIIB | Backed | 18 |
| `BILIon` | Bilibili (Ondo Tokenized) | BILI | Ondo Global Markets | 18 |
| `BILIx` | Bilibili xStock | BILI | Backed | 18 |
| `BILon` | SPDR Bloomberg 1-3 Month T-Bill ETF (Ondo Tokenized) | BIL | Ondo Global Markets | 18 |
| `BINCon` | iShares Flexible Income Active ETF (Ondo Tokenized) | BINC | Ondo Global Markets | 18 |
| `BIOx` | Bio-Rad Laboratories xStock | BIO | Backed | 18 |
| `BITXx` | Volatility Shares 2x Bitcoin Strategy xStock | BITX | Backed | 18 |
| `BJx` | BJ's Wholesale Club xStock | BJ | Backed | 18 |
| `BKCHon` | Global X Blockchain ETF (Ondo Tokenized) | BKCH | Ondo Global Markets | 18 |
| `BKG_GBx` | Berkeley xStock | BKGL | Backed | 18 |
| `BKRx` | Baker Hughes xStock | BKR | Backed | 18 |
| `BLCRon` | iShares Large Cap Core Active ETF (Ondo Tokenized) | BLCR | Ondo Global Markets | 18 |
| `BLDRx` | Builders FirstSource xStock | BLDR | Backed | 18 |
| `BLKon` | Blackrock, Inc. (Ondo Tokenized) | BLK | Ondo Global Markets | 18 |
| `BLSHon` | Bullish (Ondo Tokenized) | BLSH | Ondo Global Markets | 18 |
| `BMNRon` | BitMine Immersion Technologies (Ondo Tokenized) | BMNR | Ondo Global Markets | 18 |
| `BMNRx` | Bitmine xStock | BMNR | Backed | 18 |
| `BMRNx` | BioMarin Pharmaceutical xStock | BMRN | Backed | 18 |
| `BMWx` | Bayerische Motoren Werke xStock | BMWD | Backed | 18 |
| `BMYx` | Bristol-Myers Squibb xStock | BMY | Backed | 18 |
| `BNOon` | US Brent Oil Fund (Ondo Tokenized) | BNO | Ondo Global Markets | 18 |
| `BNPx` | BNP Paribas xStock | BNPP | Backed | 18 |
| `BNYx` | Bank of New York Mellon xStock | BNY | Backed | 18 |
| `BNZLx` | Bunzl xStock | BNZLL | Backed | 18 |
| `BN_FRx` | Danone xStock | BNP | Backed | 18 |
| `BOCHKx` | BOC Hong Kong xStock | 2388 | Backed | 18 |
| `BOCOMx` | Bank of Communications xStock | 3328 | Backed | 18 |
| `BOKFx` | BOK Financial xStock | BOKF | Backed | 18 |
| `BOTZon` | Global X Robotics & Artificial Intelligence ETF (Ondo Tokenized) | BOTZ | Ondo Global Markets | 18 |
| `BOTon` | RoboStrategy (Ondo Tokenized) | BOT | Ondo Global Markets | 18 |
| `BOTx` | RoboStrategy xStock | BOT | Backed | 18 |
| `BPEx` | BPER Banca xStock | BPEM | Backed | 18 |
| `BPOPx` | Popular xStock | BPOP | Backed | 18 |
| `BPx` | BP xStock | BPL | Backed | 18 |
| `BRBYx` | Burberry xStock | BRBYL | Backed | 18 |
| `BRHYon` | iShares High Yield Active ETF (Ondo Tokenized) | BRHY | Ondo Global Markets | 18 |
| `BRKRx` | Bruker xStock | BRKR | Backed | 18 |
| `BRK_Bx` | Berkshire Hathaway xStock | BRK.B | Backed | 18 |
| `BRLNon` | iShares Floating Rate Loan Active ETF (Ondo Tokenized) | BRLN | Ondo Global Markets | 18 |
| `BROSx` | Dutch Bros xStock | BROS | Backed | 18 |
| `BROx` | Brown & Brown xStock | BRO | Backed | 18 |
| `BRTRon` | iShares Total Return Active ETF (Ondo Tokenized) | BRTR | Ondo Global Markets | 18 |
| `BRXx` | Brixmor Property xStock | BRX | Backed | 18 |
| `BRx` | Broadridge Financial Solutions xStock | BR | Backed | 18 |
| `BSPx` | Bending Spoons xStock | BSP | Backed | 18 |
| `BSXx` | Boston Scientific xStock | BSX | Backed | 18 |
| `BSYx` | Bentley Systems xStock | BSY | Backed | 18 |
| `BTBTx` | Bit Digital xStock | BTBT | Backed | 18 |
| `BTDRon` | Bitdeer Technologies (Ondo Tokenized) | BTDR | Ondo Global Markets | 18 |
| `BTGOon` | BitGo Holdings (Ondo Tokenized) | BTGO | Ondo Global Markets | 18 |
| `BTGOx` | Bitgo xStock | BTGO | Backed | 18 |
| `BTGon` | B2Gold (Ondo Tokenized) | BTG | Ondo Global Markets | 18 |
| `BTRWx` | Barratt Redrow xStock | BTRWL | Backed | 18 |
| `BT_Ax` | BT xStock | BTL | Backed | 18 |
| `BURLx` | Burlington Stores xStock | BURL | Backed | 18 |
| `BWAx` | BorgWarner xStock | BWA | Backed | 18 |
| `BWETon` | Breakwave Tanker Shipping ETF (Ondo Tokenized) | BWET | Ondo Global Markets | 18 |
| `BWXTx` | BWX Technologies xStock | BWXT | Backed | 18 |
| `BWYx` | Bellway xStock | BWYL | Backed | 18 |
| `BXPx` | BXP xStock | BXP | Backed | 18 |
| `BXx` | Blackstone xStock | BX | Backed | 18 |
| `BYDCOx` | BYD xStock | 1211 | Backed | 18 |
| `BYDx` | Boyd Gaming xStock | BYD | Backed | 18 |
| `BZon` | Kanzhun (Ondo Tokenized) | BZ | Ondo Global Markets | 18 |
| `CABKx` | CaixaBank xStock | CABKE | Backed | 18 |
| `CACCx` | Credit Acceptance xStock | CACC | Backed | 18 |
| `CACIx` | CACI International xStock | CACI | Backed | 18 |
| `CAGx` | Conagra Brands xStock | CAG | Backed | 18 |
| `CAHx` | Cardinal Health xStock | CAH | Backed | 18 |
| `CAIx` | Caris Life Sciences xStock | CAI | Backed | 18 |
| `CAMTon` | Camtek (Ondo Tokenized) | CAMT | Ondo Global Markets | 18 |
| `CAPRon` | Capricor Therapeutics (Ondo Tokenized) | CAPR | Ondo Global Markets | 18 |
| `CARRx` | Carrier Global xStock | CARR | Backed | 18 |
| `CARx` | Avis Budget xStock | CAR | Backed | 18 |
| `CASYx` | Casey's General Stores xStock | CASY | Backed | 18 |
| `CATon` | Caterpillar (Ondo Tokenized) | CAT | Ondo Global Markets | 18 |
| `CATx` | Caterpillar xStock | CAT | Backed | 18 |
| `CBREx` | CBRE xStock | CBRE | Backed | 18 |
| `CBRSon` | Cerebras Systems (Ondo Tokenized) | CBRS | Ondo Global Markets | 18 |
| `CBRSx` | Cerebras Systems xStock | CBRS | Backed | 18 |
| `CBSHx` | Commerce Bancshares xStock | CBSH | Backed | 18 |
| `CCC_GBx` | Computacenter xStock | CCCL | Backed | 18 |
| `CCIx` | Crown Castle xStock | CCI | Backed | 18 |
| `CCJon` | Cameco (Ondo Tokenized) | CCJ | Ondo Global Markets | 18 |
| `CCKx` | Crown xStock | CCK | Backed | 18 |
| `CCONBx` | China Construction Bank xStock | 939 | Backed | 18 |
| `CDEx` | Coeur Mining xStock | CDE | Backed | 18 |
| `CDNSx` | Cadence Design Systems xStock | CDNS | Backed | 18 |
| `CDWx` | CDW xStock | CDW | Backed | 18 |
| `CEGon` | Constellation Energy (Ondo Tokenized) | CEG | Ondo Global Markets | 18 |
| `CEGx` | Constellation Energy Corporation xStock | CEG | Backed | 18 |
| `CELHx` | Celsius xStock | CELH | Backed | 18 |
| `CEVAon` | CEVA (Ondo Tokenized) | CEVA | Ondo Global Markets | 18 |
| `CFGx` | Citizens Financial xStock | CFG | Backed | 18 |
| `CFRx` | Cullen/Frost Bankers xStock | CFR | Backed | 18 |
| `CFx` | CF Industries xStock | CF | Backed | 18 |
| `CGNXx` | Cognex xStock | CGNX | Backed | 18 |
| `CGx` | The Carlyle xStock | CG | Backed | 18 |
| `CHDNx` | Churchill Downs xStock | CHDN | Backed | 18 |
| `CHDx` | Church & Dwight xStock | CHD | Backed | 18 |
| `CHEx` | Chemed xStock | CHE | Backed | 18 |
| `CHONGx` | China Hongqiao xStock | 1378 | Backed | 18 |
| `CHRDx` | Chord Energy xStock | CHRD | Backed | 18 |
| `CHRWx` | C.H. Robinson Worldwide xStock | CHRW | Backed | 18 |
| `CHTRx` | Charter Communications xStock | CHTR | Backed | 18 |
| `CHWYx` | Chewy xStock | CHWY | Backed | 18 |
| `CIBRon` | First Trust NASDAQ Cybersecurity ETF (Ondo Tokenized) | CIBR | Ondo Global Markets | 18 |
| `CIENon` | Ciena (Ondo Tokenized) | CIEN | Ondo Global Markets | 18 |
| `CIENx` | Ciena xStock | CIEN | Backed | 18 |
| `CIFRon` | Cipher Mining (Ondo Tokenized) | CIFR | Ondo Global Markets | 18 |
| `CINFx` | Cincinnati Financial xStock | CINF | Backed | 18 |
| `CITICx` | CITIC xStock | 267 | Backed | 18 |
| `CIx` | The Cigna xStock | CI | Backed | 18 |
| `CKAHx` | CK Asset xStock | 1113 | Backed | 18 |
| `CKHUTx` | CK Hutchison xStock | 1 | Backed | 18 |
| `CKINFx` | CK Infrastructure xStock | 1038 | Backed | 18 |
| `CLFon` | Cleveland-Cliffs (Ondo Tokenized) | CLF | Ondo Global Markets | 18 |
| `CLFx` | Cleveland-Cliffs xStock | CLF | Backed | 18 |
| `CLHx` | Clean Harbors xStock | CLH | Backed | 18 |
| `CLINSx` | China Life Insurance xStock | 2628 | Backed | 18 |
| `CLOAon` | iShares AAA CLO Active ETF (Ondo Tokenized) | CLOA | Ondo Global Markets | 18 |
| `CLOIon` | VanEck CLO ETF (Ondo Tokenized) | CLOI | Ondo Global Markets | 18 |
| `CLONPx` | China Longyuan Power xStock | 916 | Backed | 18 |
| `CLPHDx` | CLP xStock | 2 | Backed | 18 |
| `CLSKx` | CleanSpark xStock | CLSK | Backed | 18 |
| `CLSon` | Celestica (Ondo Tokenized) | CLS | Ondo Global Markets | 18 |
| `CLXx` | Clorox xStock | CLX | Backed | 18 |
| `CLx` | Colgate-Palmolive xStock | CL | Backed | 18 |
| `CMCSAx` | Comcast xStock | CMCSA | Backed | 18 |
| `CMENDx` | China Mengniu Dairy xStock | 2319 | Backed | 18 |
| `CMERPx` | China Merchants Port xStock | 144 | Backed | 18 |
| `CMEx` | CME xStock | CME | Backed | 18 |
| `CMGon` | Chipotle (Ondo Tokenized) | CMG | Ondo Global Markets | 18 |
| `CMGx` | Chipotle Mexican Grill xStock | CMG | Backed | 18 |
| `CMIx` | Cummins xStock | CMI | Backed | 18 |
| `CMSx` | CMS Energy xStock | CMS | Backed | 18 |
| `CNA_GBx` | Centrica xStock | CNAL | Backed | 18 |
| `CNAx` | CNA Financial xStock | CNA | Backed | 18 |
| `CNCx` | Centene xStock | CNC | Backed | 18 |
| `CNMx` | Core & Main xStock | CNM | Backed | 18 |
| `CNPx` | CenterPoint Energy xStock | CNP | Backed | 18 |
| `COFon` | Capital One (Ondo Tokenized) | COF | Ondo Global Markets | 18 |
| `COFx` | Capital One Financial xStock | COF | Backed | 18 |
| `COHRon` | Coherent (Ondo Tokenized) | COHR | Ondo Global Markets | 18 |
| `COHRx` | Coherent xStock | COHR | Backed | 18 |
| `COHUon` | Cohu (Ondo Tokenized) | COHU | Ondo Global Markets | 18 |
| `COINon` | Coinbase (Ondo Tokenized) | COIN | Ondo Global Markets | 18 |
| `COINx` | Coinbase xStock | COIN | Backed | 18 |
| `COLBx` | Columbia Banking System xStock | COLB | Backed | 18 |
| `COOx` | The Cooper Companies xStock | COO | Backed | 18 |
| `COPXon` | Global X Copper Miners ETF (Ondo Tokenized) | COPX | Ondo Global Markets | 18 |
| `COPXx` | Global X Copper Miners xStock | COPX | Backed | 18 |
| `COPon` | ConocoPhillips (Ondo Tokenized) | COP | Ondo Global Markets | 18 |
| `COPx` | ConocoPhillips xStock | COP | Backed | 18 |
| `COROon` | iShares International Country Rotation Active ETF (Ondo Tokenized) | CORO | Ondo Global Markets | 18 |
| `CORTx` | Corcept Therapeutics xStock | CORT | Backed | 18 |
| `CORZon` | Core Scientific (Ondo Tokenized) | CORZ | Ondo Global Markets | 18 |
| `CORZx` | Core Scientific xStock | CORZ | Backed | 18 |
| `CORx` | Cencora xStock | COR | Backed | 18 |
| `COSCx` | COSCO SHIPPING xStock | 1919 | Backed | 18 |
| `COSTon` | Costco (Ondo Tokenized) | COST | Ondo Global Markets | 18 |
| `COVELx` | China Overseas Land & Investment xStock | 688 | Backed | 18 |
| `CPAYx` | Corpay xStock | CPAY | Backed | 18 |
| `CPBx` | The Campbell's xStock | CPB | Backed | 18 |
| `CPERon` | US Copper Index Fund (Ondo Tokenized) | CPER | Ondo Global Markets | 18 |
| `CPETCx` | China Petroleum & Chemical xStock | 386 | Backed | 18 |
| `CPNGon` | Coupang (Ondo Tokenized) | CPNG | Ondo Global Markets | 18 |
| `CPNGx` | Coupang xStock | CPNG | Backed | 18 |
| `CPRTx` | Copart xStock | CPRT | Backed | 18 |
| `CPTx` | Camden Property Trust xStock | CPT | Backed | 18 |
| `CRAUTx` | Chery Automobile xStock | 9973 | Backed | 18 |
| `CRBGx` | Corebridge Financial xStock | CRBG | Backed | 18 |
| `CRCLon` | Circle Internet Group (Ondo Tokenized) | CRCL | Ondo Global Markets | 18 |
| `CRCLx` | Circle xStock | CRCL | Backed | 18 |
| `CRDAx` | Croda International xStock | CRDAL | Backed | 18 |
| `CRDOon` | Credo Technology Group Holding (Ondo Tokenized) | CRDO | Ondo Global Markets | 18 |
| `CRDOx` | Credo Technology xStock | CRDO | Backed | 18 |
| `CRESBx` | China Resources Beer Holdings xStock | 291 | Backed | 18 |
| `CRESLx` | China Resources Land xStock | 1109 | Backed | 18 |
| `CRESMx` | China Resources Mixc Lifestyle Services xStock | 1209 | Backed | 18 |
| `CRESPx` | China Resources Power xStock | 836 | Backed | 18 |
| `CRMon` | Salesforce (Ondo Tokenized) | CRM | Ondo Global Markets | 18 |
| `CRMx` | Salesforce xStock | CRM | Backed | 18 |
| `CROXx` | Crocs xStock | CROX | Backed | 18 |
| `CRSx` | Carpenter Technology xStock | CRS | Backed | 18 |
| `CRUSx` | Cirrus Logic xStock | CRUS | Backed | 18 |
| `CRWDon` | CrowdStrike (Ondo Tokenized) | CRWD | Ondo Global Markets | 18 |
| `CRWDx` | CrowdStrike xStock | CRWD | Backed | 18 |
| `CRWVon` | CoreWeave (Ondo Tokenized) | CRWV | Ondo Global Markets | 18 |
| `CRWVx` | CoreWeave xStock | CRWV | Backed | 18 |
| `CRx` | Crane xStock | CR | Backed | 18 |
| `CSCOon` | Cisco Systems (Ondo Tokenized) | CSCO | Ondo Global Markets | 18 |
| `CSCOx` | Cisco xStock | CSCO | Backed | 18 |
| `CSGPx` | CoStar xStock | CSGP | Backed | 18 |
| `CSHEEx` | China Shenhua Energy xStock | 1088 | Backed | 18 |
| `CSLx` | Carlisle Companies xStock | CSL | Backed | 18 |
| `CSPCx` | CSPC Pharmaceutical xStock | 1093 | Backed | 18 |
| `CSXx` | CSX xStock | CSX | Backed | 18 |
| `CSx` | AXA xStock | CSP | Backed | 18 |
| `CTASx` | Cintas xStock | CTAS | Backed | 18 |
| `CTEC_GBx` | ConvaTec xStock | CTECL | Backed | 18 |
| `CTFJWx` | Chow Tai Fook Jewellery xStock | 1929 | Backed | 18 |
| `CTINSx` | China Taiping Insurance xStock | 966 | Backed | 18 |
| `CTPCAx` | Cathay Pacific Airways xStock | 293 | Backed | 18 |
| `CTSHx` | Cognizant Technology Solutions xStock | CTSH | Backed | 18 |
| `CTVAx` | Corteva xStock | CTVA | Backed | 18 |
| `CUBEx` | CubeSmart xStock | CUBE | Backed | 18 |
| `CURYx` | Currys xStock | CURYL | Backed | 18 |
| `CVNAon` | Carvana (Ondo Tokenized) | CVNA | Ondo Global Markets | 18 |
| `CVNAx` | Carvana xStock | CVNA | Backed | 18 |
| `CVSx` | CVS Health xStock | CVS | Backed | 18 |
| `CVXon` | Chevron (Ondo Tokenized) | CVX | Ondo Global Markets | 18 |
| `CVXx` | Chevron xStock | CVX | Backed | 18 |
| `CWENx` | Clearway Energy xStock | CWEN | Backed | 18 |
| `CWK_GBx` | Cranswick xStock | CWKL | Backed | 18 |
| `CWx` | Curtiss-Wright xStock | CW | Backed | 18 |
| `CZRx` | Caesars Entertainment xStock | CZR | Backed | 18 |
| `Con` | Citigroup (Ondo Tokenized) | C | Ondo Global Markets | 18 |
| `Cx` | Citigroup xStock | C | Backed | 18 |
| `DALx` | Delta Air Lines xStock | DAL | Backed | 18 |
| `DARx` | Darling Ingredients xStock | DAR | Backed | 18 |
| `DASHon` | DoorDash (Ondo Tokenized) | DASH | Ondo Global Markets | 18 |
| `DASHx` | DoorDash xStock | DASH | Backed | 18 |
| `DAXx` | Global X DAX Germany xStock | DAX | Backed | 18 |
| `DB1x` | Deutsche Boerse xStock | DB1D | Backed | 18 |
| `DBCon` | Invesco DB Commodity Index Tracking Fund (Ondo Tokenized) | DBC | Ondo Global Markets | 18 |
| `DBKx` | Deutsche Bank xStock | DBKD | Backed | 18 |
| `DBXx` | Dropbox xStock | DBX | Backed | 18 |
| `DCIx` | Donaldson xStock | DCI | Backed | 18 |
| `DDOGx` | Datadog xStock | DDOG | Backed | 18 |
| `DDSx` | Dillard's xStock | DDS | Backed | 18 |
| `DECKx` | Deckers Outdoor xStock | DECK | Backed | 18 |
| `DELLon` | Dell Technologies (Ondo Tokenized) | DELL | Ondo Global Markets | 18 |
| `DELLx` | Dell Technologies Inc. xStock | DELL | Backed | 18 |
| `DEon` | Deere (Ondo Tokenized) | DE | Ondo Global Markets | 18 |
| `DEx` | Deere xStock | DE | Backed | 18 |
| `DFDVx` | DFDV xStock | DFDV | Backed | 18 |
| `DGEx` | Diageo xStock | DGEL | Backed | 18 |
| `DGRWon` | WisdomTree US Quality Dividend Growth Fund (Ondo Tokenized) | DGRW | Ondo Global Markets | 18 |
| `DGXXon` | Digi Power X (Ondo Tokenized) | DGXX | Ondo Global Markets | 18 |
| `DGXx` | Quest Diagnostics xStock | DGX | Backed | 18 |
| `DG_FRx` | Vinci xStock | DGP | Backed | 18 |
| `DGx` | Dollar General xStock | DG | Backed | 18 |
| `DHIx` | D.R. Horton xStock | DHI | Backed | 18 |
| `DHLx` | Deutsche Post xStock | DHLD | Backed | 18 |
| `DHRx` | Danaher xStock | DHR | Backed | 18 |
| `DINOx` | HF Sinclair xStock | DINO | Backed | 18 |
| `DISon` | Disney (Ondo Tokenized) | DIS | Ondo Global Markets | 18 |
| `DISx` | The Walt Disney xStock | DIS | Backed | 18 |
| `DJTx` | Trump Media & Technology Group xStock | DJT | Backed | 18 |
| `DKNGx` | DraftKings xStock | DKNG | Backed | 18 |
| `DKSx` | Dick's Sporting Goods xStock | DKS | Backed | 18 |
| `DLBx` | Dolby Laboratories xStock | DLB | Backed | 18 |
| `DLRx` | Digital Realty Trust xStock | DLR | Backed | 18 |
| `DLTRx` | Dollar Tree xStock | DLTR | Backed | 18 |
| `DNNon` | Denison Mines (Ondo Tokenized) | DNN | Ondo Global Markets | 18 |
| `DOCNx` | DigitalOcean xStock | DOCN | Backed | 18 |
| `DOCUx` | Docusign xStock | DOCU | Backed | 18 |
| `DOCx` | Healthpeak Properties xStock | DOC | Backed | 18 |
| `DOVx` | Dover xStock | DOV | Backed | 18 |
| `DOWx` | Dow xStock | DOW | Backed | 18 |
| `DPLMx` | Diploma xStock | DPLML | Backed | 18 |
| `DPZx` | Domino's Pizza xStock | DPZ | Backed | 18 |
| `DRAMon` | Roundhill Memory ETF (Ondo Tokenized) | DRAM | Ondo Global Markets | 18 |
| `DRAMx` | Storage ETF (Roundhill) xStock | DRAM | Backed | 18 |
| `DRIx` | Darden Restaurants xStock | DRI | Backed | 18 |
| `DRSon` | Leonardo DRS (Ondo Tokenized) | DRS | Ondo Global Markets | 18 |
| `DRSx` | Leonardo DRS xStock | DRS | Backed | 18 |
| `DRXx` | Drax xStock | DRXL | Backed | 18 |
| `DSY_FRx` | Dassault Systemes xStock | DSYP | Backed | 18 |
| `DTCRon` | Global X Data Center & Digital Infrastructure ETF (Ondo Tokenized) | DTCR | Ondo Global Markets | 18 |
| `DTE_DEx` | Deutsche Telekom xStock | DTED | Backed | 18 |
| `DTEx` | DTE Energy xStock | DTE | Backed | 18 |
| `DTG_DEx` | Daimler Truck xStock | DTGD | Backed | 18 |
| `DTx` | Dynatrace xStock | DT | Backed | 18 |
| `DUKx` | Duke Energy xStock | DUK | Backed | 18 |
| `DVAx` | DaVita xStock | DVA | Backed | 18 |
| `DVNx` | Devon Energy xStock | DVN | Backed | 18 |
| `DXCMx` | DexCom xStock | DXCM | Backed | 18 |
| `DYNFon` | iShares US Equity Factor Rotation Active ETF (Ondo Tokenized) | DYNF | Ondo Global Markets | 18 |
| `DYx` | Dycom Industries xStock | DY | Backed | 18 |
| `Dx` | Dominion Energy xStock | D | Backed | 18 |
| `EBS_ATx` | Erste Group Bank xStock | EBSV | Backed | 18 |
| `ECGx` | Everus Construction xStock | ECG | Backed | 18 |
| `ECHon` | iShares MSCI Chile ETF (Ondo Tokenized) | ECH | Ondo Global Markets | 18 |
| `ECLx` | Ecolab xStock | ECL | Backed | 18 |
| `ECOon` | Okeanis Eco Tankers (Ondo Tokenized) | ECO | Ondo Global Markets | 18 |
| `EDPx` | EDP-Energias De Portugal xStock | EDPU | Backed | 18 |
| `EDV_GBx` | Endeavour Mining xStock | EDVL | Backed | 18 |
| `EDx` | Consolidated Edison xStock | ED | Backed | 18 |
| `EEMon` | iShares MSCI Emerging Markets ETF (Ondo Tokenized) | EEM | Ondo Global Markets | 18 |
| `EFAon` | iShares MSCI EAFE ETF (Ondo Tokenized) | EFA | Ondo Global Markets | 18 |
| `EFVon` | iShares MSCI EAFE Value ETF (Ondo Tokenized) | EFV | Ondo Global Markets | 18 |
| `EFXx` | Equifax xStock | EFX | Backed | 18 |
| `EGPx` | EastGroup Properties xStock | EGP | Backed | 18 |
| `EGx` | Everest xStock | EG | Backed | 18 |
| `EHCx` | Encompass Health xStock | EHC | Backed | 18 |
| `EIXx` | Edison International xStock | EIX | Backed | 18 |
| `ELANx` | Elanco Animal Health xStock | ELAN | Backed | 18 |
| `ELE_ESx` | Endesa, S.A. xStock | ELEE | Backed | 18 |
| `ELFx` | e.l.f. Beauty xStock | ELF | Backed | 18 |
| `ELSx` | Equity Lifestyle Properties xStock | ELS | Backed | 18 |
| `ELVx` | Elevance Health xStock | ELV | Backed | 18 |
| `EL_FRx` | Essilorluxottica xStock | ELP | Backed | 18 |
| `ELx` | The Estee Lauder Companies xStock | EL | Backed | 18 |
| `EMEx` | EMCOR xStock | EME | Backed | 18 |
| `EMGx` | Man xStock | EMGL | Backed | 18 |
| `EMNx` | Eastman Chemical xStock | EMN | Backed | 18 |
| `EMRon` | Emerson Electric (Ondo Tokenized) | EMR | Ondo Global Markets | 18 |
| `EMRx` | Emerson Electric xStock | EMR | Backed | 18 |
| `ENBon` | Enbridge (Ondo Tokenized) | ENB | Ondo Global Markets | 18 |
| `ENELx` | Enel xStock | ENELM | Backed | 18 |
| `ENGIx` | Engie xStock | ENGIP | Backed | 18 |
| `ENHAx` | Enhanced Group xStock | ENHA | Backed | 18 |
| `ENIx` | Eni xStock | ENIM | Backed | 18 |
| `ENLVon` | Enlivex Therapeutics (Ondo Tokenized) | ENLV | Ondo Global Markets | 18 |
| `ENNHLx` | ENN Energy xStock | 2688 | Backed | 18 |
| `ENPHon` | Enphase Energy (Ondo Tokenized) | ENPH | Ondo Global Markets | 18 |
| `ENR_DEx` | Siemens Energy xStock | ENRD | Backed | 18 |
| `ENSGx` | Ensign xStock | ENSG | Backed | 18 |
| `ENTGon` | Entegris (Ondo Tokenized) | ENTG | Ondo Global Markets | 18 |
| `ENTGx` | Entegris xStock | ENTG | Backed | 18 |
| `ENTx` | Entain xStock | ENTL | Backed | 18 |
| `ENx` | Bouygues xStock | ENP | Backed | 18 |
| `EOANx` | E.ON xStock | EOAND | Backed | 18 |
| `EOGx` | EOG Resources xStock | EOG | Backed | 18 |
| `EPAMx` | EPAM Systems xStock | EPAM | Backed | 18 |
| `EQHx` | Equitable xStock | EQH | Backed | 18 |
| `EQIXon` | Equinix (Ondo Tokenized) | EQIX | Ondo Global Markets | 18 |
| `EQIXx` | Equinix xStock | EQIX | Backed | 18 |
| `EQTon` | EQT (Ondo Tokenized) | EQT | Ondo Global Markets | 18 |
| `EQTx` | EQT xStock | EQT | Backed | 18 |
| `ESIx` | Element Solutions xStock | ESI | Backed | 18 |
| `ESSx` | Essex Property Trust xStock | ESS | Backed | 18 |
| `ESx` | Eversource Energy xStock | ES | Backed | 18 |
| `ETHAon` | iShares Ethereum Trust (Ondo Tokenized) | ETHA | Ondo Global Markets | 18 |
| `ETNon` | Eaton (Ondo Tokenized) | ETN | Ondo Global Markets | 18 |
| `ETNx` | Eaton Corporation plc xStock | ETN | Backed | 18 |
| `ETRx` | Entergy xStock | ETR | Backed | 18 |
| `ETSYx` | Etsy xStock | ETSY | Backed | 18 |
| `EUHYon` | iShares Euro High Yield Corporate Bond USD Hedged ETF (Ondo Tokenized) | EUHY | Ondo Global Markets | 18 |
| `EVRGx` | Evergy xStock | EVRG | Backed | 18 |
| `EVRx` | Evercore xStock | EVR | Backed | 18 |
| `EWBCx` | East West Bancorp xStock | EWBC | Backed | 18 |
| `EWGx` | iShares MSCI Germany xStock | EWG | Backed | 18 |
| `EWJon` | iShares MSCI Japan ETF (Ondo Tokenized) | EWJ | Ondo Global Markets | 18 |
| `EWJx` | iShares MSCI Japan ETF xStock | EWJ | Backed | 18 |
| `EWQx` | iShares MSCI France xStock | EWQ | Backed | 18 |
| `EWTx` | iShares MSCI Taiwan ETF xStock | EWT | Backed | 18 |
| `EWUx` | iShares MSCI United Kingdom xStock | EWU | Backed | 18 |
| `EWYon` | iShares MSCI South Korea ETF (Ondo Tokenized) | EWY | Ondo Global Markets | 18 |
| `EWYx` | iShares MSCI South Korea xStock | EWY | Backed | 18 |
| `EWZon` | iShares MSCI Brazil ETF (Ondo Tokenized) | EWZ | Ondo Global Markets | 18 |
| `EWZx` | iShares MSCI Brazil ETF xStock | EWZ | Backed | 18 |
| `EWx` | Edwards Lifesciences xStock | EW | Backed | 18 |
| `EXCx` | Exelon xStock | EXC | Backed | 18 |
| `EXELx` | Exelixis xStock | EXEL | Backed | 18 |
| `EXEx` | Expand Energy xStock | EXE | Backed | 18 |
| `EXLSx` | ExlService xStock | EXLS | Backed | 18 |
| `EXODon` | Exodus Movement (Ondo Tokenized) | EXOD | Ondo Global Markets | 18 |
| `EXPDx` | Expeditors International of Washington xStock | EXPD | Backed | 18 |
| `EXPNx` | Experian xStock | EXPNL | Backed | 18 |
| `EXPx` | Eagle Materials xStock | EXP | Backed | 18 |
| `EXRx` | Extra Space Storage xStock | EXR | Backed | 18 |
| `EXTRon` | Extreme Networks (Ondo Tokenized) | EXTR | Ondo Global Markets | 18 |
| `FAAAx` | Fidelity AAA CLO xStock | FAAA | Backed | 18 |
| `FAFx` | First American Financial xStock | FAF | Backed | 18 |
| `FANGx` | Diamondback Energy xStock | FANG | Backed | 18 |
| `FASTx` | Fastenal xStock | FAST | Backed | 18 |
| `FBINx` | Fortune Brands Innovations xStock | FBIN | Backed | 18 |
| `FCELon` | FuelCell Energy (Ondo Tokenized) | FCEL | Ondo Global Markets | 18 |
| `FCNCAx` | First Citizens BancShares xStock | FCNCA | Backed | 18 |
| `FCXon` | Freeport-McMoRan (Ondo Tokenized) | FCX | Ondo Global Markets | 18 |
| `FCXx` | Freeport-McMoRan xStock | FCX | Backed | 18 |
| `FDSx` | FactSet Research Systems xStock | FDS | Backed | 18 |
| `FDXFx` | FedEx Freight xStock | FDXF | Backed | 18 |
| `FDXx` | FedEx xStock | FDX | Backed | 18 |
| `FERGx` | Ferguson Enterprises xStock | FERG | Backed | 18 |
| `FEZx` | SPDR EURO STOXX 50 xStock | FEZ | Backed | 18 |
| `FEx` | FirstEnergy xStock | FE | Backed | 18 |
| `FFIVx` | F5 xStock | FFIV | Backed | 18 |
| `FFOGon` | Franklin Focused Growth ETF (Ondo Tokenized) | FFOG | Ondo Global Markets | 18 |
| `FGDLon` | Franklin Responsibly Sourced Gold ETF (Ondo Tokenized) | FGDL | Ondo Global Markets | 18 |
| `FGDLx` | Franklin Responsibly Sourced Gold ETF xStock | FGDL | Backed | 18 |
| `FHNx` | First Horizon xStock | FHN | Backed | 18 |
| `FICOx` | Fair Isaac xStock | FICO | Backed | 18 |
| `FIGRon` | Figure Technology Solutions (Ondo Tokenized) | FIGR | Ondo Global Markets | 18 |
| `FIGon` | Figma (Ondo Tokenized) | FIG | Ondo Global Markets | 18 |
| `FISVx` | Fiserv xStock | FISV | Backed | 18 |
| `FISx` | Fidelity National Information Services xStock | FIS | Backed | 18 |
| `FITBx` | Fifth Third Bancorp xStock | FITB | Backed | 18 |
| `FIVEx` | Five Below xStock | FIVE | Backed | 18 |
| `FIXx` | Comfort Systems USA xStock | FIX | Backed | 18 |
| `FLBLx` | Franklin Senior Loan xStock | FLBL | Backed | 18 |
| `FLEXon` | Flex (Ondo Tokenized) | FLEX | Ondo Global Markets | 18 |
| `FLHYon` | Franklin High Yield Corporate ETF (Ondo Tokenized) | FLHY | Ondo Global Markets | 18 |
| `FLNCon` | Fluence Energy (Ondo Tokenized) | FLNC | Ondo Global Markets | 18 |
| `FLNCx` | Fluence Energy xStock | FLNC | Backed | 18 |
| `FLQLon` | Franklin US Large Cap Multifactor Index ETF (Ondo Tokenized) | FLQL | Ondo Global Markets | 18 |
| `FLQMx` | Franklin U.S. Mid Cap Multi-Factor xStock | FLQM | Backed | 18 |
| `FLSx` | Flowserve xStock | FLS | Backed | 18 |
| `FLYx` | Firefly Aerospace xStock | FLY | Backed | 18 |
| `FNBx` | F N B xStock | FNB | Backed | 18 |
| `FNDx` | Floor & Decor xStock | FND | Backed | 18 |
| `FNFx` | Fidelity National Financial xStock | FNF | Backed | 18 |
| `FNon` | Fabrinet (Ondo Tokenized) | FN | Ondo Global Markets | 18 |
| `FNx` | Fabrinet xStock | FN | Backed | 18 |
| `FORMon` | FormFactor (Ondo Tokenized) | FORM | Ondo Global Markets | 18 |
| `FORMx` | FormFactor xStock | FORM | Backed | 18 |
| `FPSon` | Forgent Power Solutions (Ondo Tokenized) | FPS | Ondo Global Markets | 18 |
| `FPSx` | Forgent Power Solutions xStock | FPS | Backed | 18 |
| `FRESx` | Fresnillo xStock | FRESL | Backed | 18 |
| `FRE_DEx` | Fresenius xStock | FRED | Backed | 18 |
| `FRHCx` | Freedom xStock | FRHC | Backed | 18 |
| `FRTx` | Federal Realty Investment Trust xStock | FRT | Backed | 18 |
| `FRx` | First Industrial Realty Trust xStock | FR | Backed | 18 |
| `FSLRx` | First Solar xStock | FSLR | Backed | 18 |
| `FSMLx` | Franklin Small Cap Enhanced xStock | FSML | Backed | 18 |
| `FSOLon` | Fidelity Solana Fund (Ondo Tokenized) | FSOL | Ondo Global Markets | 18 |
| `FTAIx` | FTAI Aviation xStock | FTAI | Backed | 18 |
| `FTGCon` | First Trust Global Tactical Commodity Strategy Fund (Ondo Tokenized) | FTGC | Ondo Global Markets | 18 |
| `FTNTx` | Fortinet xStock | FTNT | Backed | 18 |
| `FTVx` | Fortive xStock | FTV | Backed | 18 |
| `FUTUon` | Futu Holdings (Ondo Tokenized) | FUTU | Ondo Global Markets | 18 |
| `FWDIx` | Forward Industries xStock | FWDI | Backed | 18 |
| `FWONKx` | Liberty Media xStock | FWONK | Backed | 18 |
| `FXIon` | iShares China Large-Cap ETF (Ondo Tokenized) | FXI | Ondo Global Markets | 18 |
| `Fon` | Ford Motor (Ondo Tokenized) | F | Ondo Global Markets | 18 |
| `Fx` | Ford Motor xStock | F | Backed | 18 |
| `GAPx` | Gap xStock | GAP | Backed | 18 |
| `GAWx` | Games Workshop xStock | GAWL | Backed | 18 |
| `GDDYx` | GoDaddy xStock | GDDY | Backed | 18 |
| `GDXx` | VanEck Gold Miners xStock | GDX | Backed | 18 |
| `GDon` | General Dynamics (Ondo Tokenized) | GD | Ondo Global Markets | 18 |
| `GDx` | General Dynamics xStock | GD | Backed | 18 |
| `GEELx` | Geely Automobile xStock | 175 | Backed | 18 |
| `GEHCx` | GE HealthCare Technologies xStock | GEHC | Backed | 18 |
| `GEMIon` | Gemini Space Station (Ondo Tokenized) | GEMI | Ondo Global Markets | 18 |
| `GENTEx` | Galaxy Entertainment xStock | 27 | Backed | 18 |
| `GENx` | Gen Digital xStock | GEN | Backed | 18 |
| `GEVon` | GE Vernova (Ondo Tokenized) | GEV | Ondo Global Markets | 18 |
| `GEVx` | GE Vernova Inc. xStock | GEV | Backed | 18 |
| `GEon` | General Electric (Ondo Tokenized) | GE | Ondo Global Markets | 18 |
| `GEx` | GE Aerospace xStock | GE | Backed | 18 |
| `GFLx` | GFL Environmental xStock | GFL | Backed | 18 |
| `GFSon` | GlobalFoundries (Ondo Tokenized) | GFS | Ondo Global Markets | 18 |
| `GFSx` | GLOBALFOUNDRIES xStock | GFS | Backed | 18 |
| `GGGx` | Graco xStock | GGG | Backed | 18 |
| `GGOVon` | iShares Global Government Bond USD Hedged Active ETF (Ondo Tokenized) | GGOV | Ondo Global Markets | 18 |
| `GHx` | Guardant Health xStock | GH | Backed | 18 |
| `GILDx` | Gilead Sciences xStock | GILD | Backed | 18 |
| `GISx` | General Mills xStock | GIS | Backed | 18 |
| `GLDon` | SPDR Gold Shares (Ondo Tokenized) | GLD | Ondo Global Markets | 18 |
| `GLDx` | Gold xStock | GLD | Backed | 18 |
| `GLENx` | Glencore xStock | GLENL | Backed | 18 |
| `GLE_FRx` | Societe Generale xStock | GLEP | Backed | 18 |
| `GLPIx` | Gaming and Leisure Properties xStock | GLPI | Backed | 18 |
| `GLTRon` | abrdn Physical Precious Metals Basket Shares ETF (Ondo Tokenized) | GLTR | Ondo Global Markets | 18 |
| `GLWon` | Corning (Ondo Tokenized) | GLW | Ondo Global Markets | 18 |
| `GLWx` | Corning xStock | GLW | Backed | 18 |
| `GLXYon` | Galaxy Digital (Ondo Tokenized) | GLXY | Ondo Global Markets | 18 |
| `GLXYx` | Galaxy Digital xStock | GLXY | Backed | 18 |
| `GLx` | Globe Life xStock | GL | Backed | 18 |
| `GMEDx` | Globus Medical xStock | GMED | Backed | 18 |
| `GMEon` | GameStop (Ondo Tokenized) | GME | Ondo Global Markets | 18 |
| `GMEx` | Gamestop xStock | GME | Backed | 18 |
| `GMx` | General Motors xStock | GM | Backed | 18 |
| `GNRCon` | Generac Holdings (Ondo Tokenized) | GNRC | Ondo Global Markets | 18 |
| `GNRCx` | Generac xStock | GNRC | Backed | 18 |
| `GNS_GBx` | Genus xStock | GNSL | Backed | 18 |
| `GOOGLon` | Alphabet Class A (Ondo Tokenized) | GOOGL | Ondo Global Markets | 18 |
| `GOOGLx` | Alphabet xStock | GOOGL | Backed | 18 |
| `GOOGon` | Alphabet Class C (Ondo Tokenized) | GOOG | Ondo Global Markets | 18 |
| `GPCx` | Genuine Parts xStock | GPC | Backed | 18 |
| `GPNx` | Global Payments xStock | GPN | Backed | 18 |
| `GPROx` | GoPro xStock | GPRO | Backed | 18 |
| `GRABon` | Grab Holdings (Ondo Tokenized) | GRAB | Ondo Global Markets | 18 |
| `GRG_GBx` | Greggs xStock | GRGL | Backed | 18 |
| `GRNDon` | Grindr (Ondo Tokenized) | GRND | Ondo Global Markets | 18 |
| `GSATx` | Globalstar xStock | GSAT | Backed | 18 |
| `GSKx` | GSK xStock | GSKL | Backed | 18 |
| `GSon` | Goldman Sachs (Ondo Tokenized) | GS | Ondo Global Markets | 18 |
| `GSx` | Goldman Sachs xStock | GS | Backed | 18 |
| `GTESx` | Gates Industrial xStock | GTES | Backed | 18 |
| `GTLBx` | GitLab xStock | GTLB | Backed | 18 |
| `GWREx` | Guidewire Software xStock | GWRE | Backed | 18 |
| `GWWx` | W.W. Grainger xStock | GWW | Backed | 18 |
| `GXOx` | GXO Logistics xStock | GXO | Backed | 18 |
| `G_ITx` | Generali xStock | MTAA:GM | Backed | 18 |
| `Gx` | Genpact xStock | G | Backed | 18 |
| `HAIDLx` | Haidilao International xStock | 6862 | Backed | 18 |
| `HAIERx` | Haier Smart Home xStock | 6690 | Backed | 18 |
| `HALOx` | Halozyme Therapeutics xStock | HALO | Backed | 18 |
| `HALon` | Halliburton (Ondo Tokenized) | HAL | Ondo Global Markets | 18 |
| `HALx` | Halliburton xStock | HAL | Backed | 18 |
| `HASx` | Hasbro xStock | HAS | Backed | 18 |
| `HBANx` | Huntington Bancshares xStock | HBAN | Backed | 18 |
| `HBR_GBx` | Harbour Energy xStock | HBRL | Backed | 18 |
| `HCAx` | HCA Healthcare xStock | HCA | Backed | 18 |
| `HDon` | Home Depot (Ondo Tokenized) | HD | Ondo Global Markets | 18 |
| `HDx` | Home Depot xStock | HD | Backed | 18 |
| `HEIAx` | Heineken xStock | HEIAA | Backed | 18 |
| `HEI_DEx` | Heidelberg Materials xStock | HEID | Backed | 18 |
| `HEIx` | Heico xStock | HEI | Backed | 18 |
| `HIGx` | The Hartford Insurance xStock | HIG | Backed | 18 |
| `HIIon` | Huntington Ingalls Industries (Ondo Tokenized) | HII | Ondo Global Markets | 18 |
| `HIIx` | Huntington Ingalls Industries xStock | HII | Backed | 18 |
| `HIK_GBx` | Hikma Pharmaceuticals xStock | HIKL | Backed | 18 |
| `HILSx` | Hill & Smith xStock | HILSL | Backed | 18 |
| `HIMSon` | Hims & Hers Health (Ondo Tokenized) | HIMS | Ondo Global Markets | 18 |
| `HIMSx` | Hims & Hers xStock | HIMS | Backed | 18 |
| `HIMXon` | Himax Technologies (Ondo Tokenized) | HIMX | Ondo Global Markets | 18 |
| `HIVEon` | HIVE Digital Technologies (Ondo Tokenized) | HIVE | Ondo Global Markets | 18 |
| `HKCGAx` | Hong Kong and China Gas xStock | 3 | Backed | 18 |
| `HKEXCx` | Hong Kong Exchanges and Clearing xStock | 388 | Backed | 18 |
| `HLITon` | Harmonic (Ondo Tokenized) | HLIT | Ondo Global Markets | 18 |
| `HLIx` | Houlihan Lokey xStock | HLI | Backed | 18 |
| `HLMAx` | Halma xStock | HLMAL | Backed | 18 |
| `HLNx` | Haleon xStock | HLNL | Backed | 18 |
| `HLTx` | Hilton Worldwide xStock | HLT | Backed | 18 |
| `HLx` | Hecla Mining xStock | HL | Backed | 18 |
| `HNDLDx` | Henderson Land Development xStock | 12 | Backed | 18 |
| `HONx` | Honeywell xStock | HON | Backed | 18 |
| `HOODon` | Robinhood Markets (Ondo Tokenized) | HOOD | Ondo Global Markets | 18 |
| `HOODx` | Robinhood xStock | HOOD | Backed | 18 |
| `HOx` | Thales xStock | HOP | Backed | 18 |
| `HPEon` | Hewlett Packard Enterprise (Ondo Tokenized) | HPE | Ondo Global Markets | 18 |
| `HPEx` | Hewlett Packard Enterprise xStock | HPE | Backed | 18 |
| `HPQx` | HP xStock | HPQ | Backed | 18 |
| `HRBx` | H&R Block xStock | HRB | Backed | 18 |
| `HRLx` | Hormel Foods xStock | HRL | Backed | 18 |
| `HRZRBx` | Horizon Robotics xStock | 9660 | Backed | 18 |
| `HRx` | Healthcare Realty Trust xStock | HR | Backed | 18 |
| `HSAIon` | Hesai Group (Ondo Tokenized) | HSAI | Ondo Global Markets | 18 |
| `HSBAx` | HSBC xStock | HSBAL | Backed | 18 |
| `HSICx` | Henry Schein xStock | HSIC | Backed | 18 |
| `HSTx` | Host Hotels & Resorts xStock | HST | Backed | 18 |
| `HSXx` | Hiscox xStock | HSXL | Backed | 18 |
| `HSYx` | The Hershey xStock | HSY | Backed | 18 |
| `HTZon` | Hertz Global Holdings (Ondo Tokenized) | HTZ | Ondo Global Markets | 18 |
| `HUBBon` | Hubbell (Ondo Tokenized) | HUBB | Ondo Global Markets | 18 |
| `HUBBx` | Hubbell xStock | HUBB | Backed | 18 |
| `HUBSx` | HubSpot xStock | HUBS | Backed | 18 |
| `HUMx` | Humana xStock | HUM | Backed | 18 |
| `HUTon` | Hut 8 (Ondo Tokenized) | HUT | Ondo Global Markets | 18 |
| `HUTx` | Hut 8 xStock | HUT | Backed | 18 |
| `HWDNx` | Howden Joinery xStock | HWDNL | Backed | 18 |
| `HWMx` | Howmet Aerospace xStock | HWM | Backed | 18 |
| `HXLx` | Hexcel xStock | HXL | Backed | 18 |
| `HYDBon` | iShares High Yield Systematic Bond ETF (Ondo Tokenized) | HYDB | Ondo Global Markets | 18 |
| `HYGWon` | iShares High Yield Corporate Bond BuyWrite Strategy ETF (Ondo Tokenized) | HYGW | Ondo Global Markets | 18 |
| `HYGon` | iBoxx $ High Yield Corporate Bond ETF (Ondo Tokenized) | HYG | Ondo Global Markets | 18 |
| `HYSon` | PIMCO 0-5 Year High Yield Corporate Bond Index ETF (Ondo Tokenized) | HYS | Ondo Global Markets | 18 |
| `Hx` | Hyatt Hotels xStock | H | Backed | 18 |
| `IAG_GBx` | International Consolidated Airlines xStock | IAGL | Backed | 18 |
| `IALTon` | iShares Systematic Alternatives Active ETF (Ondo Tokenized) | IALT | Ondo Global Markets | 18 |
| `IAUon` | iShares Gold Trust (Ondo Tokenized) | IAU | Ondo Global Markets | 18 |
| `IBEx` | Iberdrola xStock | IBEE | Backed | 18 |
| `IBITon` | iShares Bitcoin Trust (Ondo Tokenized) | IBIT | Ondo Global Markets | 18 |
| `IBKRx` | Interactive Brokers xStock | IBKR | Backed | 18 |
| `IBMon` | IBM (Ondo Tokenized) | IBM | Ondo Global Markets | 18 |
| `IBMx` | International Business Machines xStock | IBM | Backed | 18 |
| `ICBCx` | Industrial And Commercial Bank Of China xStock | 1398 | Backed | 18 |
| `ICEx` | Intercontinental Exchange xStock | ICE | Backed | 18 |
| `ICG_GBx` | ICG xStock | ICGL | Backed | 18 |
| `ICHRon` | Ichor Holdings (Ondo Tokenized) | ICHR | Ondo Global Markets | 18 |
| `IDAx` | Idacorp xStock | IDA | Backed | 18 |
| `IDEFon` | iShares Defense Industrials Active ETF (Ondo Tokenized) | IDEF | Ondo Global Markets | 18 |
| `IDXXx` | IDEXX Laboratories xStock | IDXX | Backed | 18 |
| `IEFAon` | iShares Core MSCI EAFE ETF (Ondo Tokenized) | IEFA | Ondo Global Markets | 18 |
| `IEFon` | iShares 7-10 Year Treasury Bond ETF (Ondo Tokenized) | IEF | Ondo Global Markets | 18 |
| `IEIon` | iShares 3-7 Year Treasury Bond ETF (Ondo Tokenized) | IEI | Ondo Global Markets | 18 |
| `IEMGon` | iShares Core MSCI Emerging Markets ETF (Ondo Tokenized) | IEMG | Ondo Global Markets | 18 |
| `IEMGx` | Core MSCI Emerging Markets xStock | IEMG | Backed | 18 |
| `IESCx` | IES xStock | IESC | Backed | 18 |
| `IEXx` | IDEX xStock | IEX | Backed | 18 |
| `IFFx` | International Flavors & Fragrances xStock | IFF | Backed | 18 |
| `IFXx` | Infineon Technologies xStock | IFXD | Backed | 18 |
| `IGEBon` | iShares Investment Grade Systematic Bond ETF (Ondo Tokenized) | IGEB | Ondo Global Markets | 18 |
| `IGGx` | IG xStock | IGGL | Backed | 18 |
| `IGVon` | iShares Expanded Tech-Software ETF (Ondo Tokenized) | IGV | Ondo Global Markets | 18 |
| `IJHon` | iShares Core S&P MidCap ETF (Ondo Tokenized) | IJH | Ondo Global Markets | 18 |
| `IJRx` | S&P Small Cap xStock | IJR | Backed | 18 |
| `IJSon` | iShares S&P Small-Cap 600 Value ETF (Ondo Tokenized) | IJS | Ondo Global Markets | 18 |
| `ILMNx` | Illumina xStock | ILMN | Backed | 18 |
| `IMBx` | Imperial Brands xStock | IMBL | Backed | 18 |
| `IMIx` | IMI xStock | IMIL | Backed | 18 |
| `INCEon` | Franklin Income Equity Focus ETF (Ondo Tokenized) | INCE | Ondo Global Markets | 18 |
| `INCHx` | Inchcape xStock | INCHL | Backed | 18 |
| `INCYx` | Incyte xStock | INCY | Backed | 18 |
| `INDAon` | iShares MSCI India ETF (Ondo Tokenized) | INDA | Ondo Global Markets | 18 |
| `INDIx` | Indie Semiconductor xStock | INDI | Backed | 18 |
| `INFQx` | Infleqtion xStock | INFQ | Backed | 18 |
| `INF_GBx` | Informa xStock | INFL | Backed | 18 |
| `INGAx` | ING Groep xStock | INGAA | Backed | 18 |
| `INGMx` | Ingram Micro xStock | INGM | Backed | 18 |
| `INGRx` | Ingredion xStock | INGR | Backed | 18 |
| `INODon` | Innodata (Ondo Tokenized) | INOD | Ondo Global Markets | 18 |
| `INROon` | iShares US Industry Rotation Active ETF (Ondo Tokenized) | INRO | Ondo Global Markets | 18 |
| `INSMx` | Insmed xStock | INSM | Backed | 18 |
| `INSWon` | International Seaways (Ondo Tokenized) | INSW | Ondo Global Markets | 18 |
| `INTCon` | Intel (Ondo Tokenized) | INTC | Ondo Global Markets | 18 |
| `INTCx` | Intel xStock | INTC | Backed | 18 |
| `INTUon` | Intuit (Ondo Tokenized) | INTU | Ondo Global Markets | 18 |
| `INTUx` | Intuit xStock | INTU | Backed | 18 |
| `INTWx` | INTC 2x Long ETF xStock | INTW | Backed | 18 |
| `INVHx` | Invitation Homes xStock | INVH | Backed | 18 |
| `INVPx` | Investec xStock | INVPL | Backed | 18 |
| `IONQon` | IonQ (Ondo Tokenized) | IONQ | Ondo Global Markets | 18 |
| `IONQx` | IonQ xStock | IONQ | Backed | 18 |
| `IONSx` | Ionis Pharmaceuticals xStock | IONS | Backed | 18 |
| `IOTx` | Samsara xStock | IOT | Backed | 18 |
| `IPx` | International Paper xStock | IP | Backed | 18 |
| `IQMx` | Franklin Intelligent Machines xStock | IQM | Backed | 18 |
| `IQVx` | IQVIA xStock | IQV | Backed | 18 |
| `IRDMon` | Iridium Communications (Ondo Tokenized) | IRDM | Ondo Global Markets | 18 |
| `IRDMx` | Iridium Communications xStock | IRDM | Backed | 18 |
| `IRENon` | Iren (Ondo Tokenized) | IREN | Ondo Global Markets | 18 |
| `IRENx` | IREN xStock | IREN | Backed | 18 |
| `IRMx` | Iron Mountain xStock | IRM | Backed | 18 |
| `IRx` | Ingersoll Rand xStock | IR | Backed | 18 |
| `ISPx` | Intesa Sanpaolo xStock | ISPM | Backed | 18 |
| `ISRGon` | Intuitive Surgical (Ondo Tokenized) | ISRG | Ondo Global Markets | 18 |
| `ISRGx` | Intuitive Surgical xStock | ISRG | Backed | 18 |
| `ITAon` | iShares US Aerospace and Defense ETF (Ondo Tokenized) | ITA | Ondo Global Markets | 18 |
| `ITAx` | iShares U.S. Aerospace & Defense ETF xStock | ITA | Backed | 18 |
| `ITOTon` | iShares Core S&P Total US Stock Market ETF (Ondo Tokenized) | ITOT | Ondo Global Markets | 18 |
| `ITTx` | ITT xStock | ITT | Backed | 18 |
| `ITWx` | Illinois Tool Works xStock | ITW | Backed | 18 |
| `ITX_ESx` | Industria De Diseno Textil xStock | ITXE | Backed | 18 |
| `ITx` | Gartner xStock | IT | Backed | 18 |
| `IVVon` | iShares Core S&P 500 ETF (Ondo Tokenized) | IVV | Ondo Global Markets | 18 |
| `IVZx` | Invesco xStock | IVZ | Backed | 18 |
| `IWFon` | iShares Russell 1000 Growth ETF (Ondo Tokenized) | IWF | Ondo Global Markets | 18 |
| `IWMon` | iShares Russell 2000 ETF (Ondo Tokenized) | IWM | Ondo Global Markets | 18 |
| `IWMx` | Russell 2000 xStock | IWM | Backed | 18 |
| `IWNon` | iShares Russell 2000 Value ETF (Ondo Tokenized) | IWN | Ondo Global Markets | 18 |
| `IYWon` | iShares US Technology ETF (Ondo Tokenized) | IYW | Ondo Global Markets | 18 |
| `JAAAon` | Janus Henderson AAA CLO ETF (Ondo Tokenized) | JAAA | Ondo Global Markets | 18 |
| `JAAAx` | Janus Henderson AAA CLO xStock | JAAA | Backed | 18 |
| `JANx` | Janus Living xStock | JAN | Backed | 18 |
| `JBHTx` | JB Hunt Transport Services xStock | JBHT | Backed | 18 |
| `JBLon` | Jabil (Ondo Tokenized) | JBL | Ondo Global Markets | 18 |
| `JBLx` | Jabil xStock | JBL | Backed | 18 |
| `JDHLTx` | JD Health International xStock | 6618 | Backed | 18 |
| `JDLOGx` | JD Logistics xStock | 2618 | Backed | 18 |
| `JD_GBx` | JD Sports Fashion xStock | JDL | Backed | 18 |
| `JDon` | JD.com (Ondo Tokenized) | JD | Ondo Global Markets | 18 |
| `JDx` | JD.com xStock | JD | Backed | 18 |
| `JEFx` | Jefferies Financial xStock | JEF | Backed | 18 |
| `JKHYx` | Jack Henry & Associates xStock | JKHY | Backed | 18 |
| `JLLx` | Jones Lang LaSalle xStock | JLL | Backed | 18 |
| `JMKEx` | Jersey Mike's Subs xStock | JMKE | Backed | 18 |
| `JNJon` | Johnson & Johnson (Ondo Tokenized) | JNJ | Ondo Global Markets | 18 |
| `JNJx` | Johnson & Johnson xStock | JNJ | Backed | 18 |
| `JPMon` | JPMorgan Chase (Ondo Tokenized) | JPM | Ondo Global Markets | 18 |
| `JPMx` | JPMorgan Chase xStock | JPM | Backed | 18 |
| `JPSTx` | JPMorgan Ultra-Short Income xStock | JPST | Backed | 18 |
| `JTGEXx` | J&T Global Express xStock | 1519 | Backed | 18 |
| `Jx` | Jacobs Solutions xStock | J | Backed | 18 |
| `KBCx` | KBC xStock | KBCB | Backed | 18 |
| `KDPx` | Keurig Dr Pepper xStock | KDP | Backed | 18 |
| `KEELon` | Keel Infrastructure (Ondo Tokenized) | KEEL | Ondo Global Markets | 18 |
| `KERx` | Kering xStock | KERP | Backed | 18 |
| `KEXx` | Kirby xStock | KEX | Backed | 18 |
| `KEYSon` | Keysight Technologies (Ondo Tokenized) | KEYS | Ondo Global Markets | 18 |
| `KEYSx` | Keysight Technologies xStock | KEYS | Backed | 18 |
| `KEYx` | KeyCorp xStock | KEY | Backed | 18 |
| `KGFx` | Kingfisher xStock | KGFL | Backed | 18 |
| `KHCx` | The Kraft Heinz xStock | KHC | Backed | 18 |
| `KIMx` | Kimco Realty xStock | KIM | Backed | 18 |
| `KKRx` | KKR xStock | KKR | Backed | 18 |
| `KLACon` | KLA (Ondo Tokenized) | KLAC | Ondo Global Markets | 18 |
| `KLACx` | KLA Corporation xStock | KLAC | Backed | 18 |
| `KMBx` | Kimberly-Clark xStock | KMB | Backed | 18 |
| `KMIx` | Kinder Morgan xStock | KMI | Backed | 18 |
| `KMXx` | CarMax xStock | KMX | Backed | 18 |
| `KNEBVx` | KONE Class B xStock | KNEBVH | Backed | 18 |
| `KNSLx` | Kinsale Capital xStock | KNSL | Backed | 18 |
| `KNXx` | Knight-Swift Transportation xStock | KNX | Backed | 18 |
| `KOPNon` | Kopin (Ondo Tokenized) | KOPN | Ondo Global Markets | 18 |
| `KORUx` | Korea 3x Long ETF xStock | KORU | Backed | 18 |
| `KOon` | Coca-Cola (Ondo Tokenized) | KO | Ondo Global Markets | 18 |
| `KOx` | Coca-Cola xStock | KO | Backed | 18 |
| `KRAQx` | KRAQ xStock | KRAQ | Backed | 18 |
| `KRMNx` | Karman xStock | KRMN | Backed | 18 |
| `KRx` | The Kroger xStock | KR | Backed | 18 |
| `KTOSx` | Kratos Defense & Security Solutions xStock | KTOS | Backed | 18 |
| `KUAIx` | Kuaishou Technology xStock | 1024 | Backed | 18 |
| `KUNLx` | Kunlun Energy xStock | 135 | Backed | 18 |
| `KVUEx` | Kenvue xStock | KVUE | Backed | 18 |
| `KWEBon` | KraneShares CSI China Internet ETF (Ondo Tokenized) | KWEB | Ondo Global Markets | 18 |
| `LADx` | Lithia Motors xStock | LAD | Backed | 18 |
| `LAMRx` | Lamar Advertising xStock | LAMR | Backed | 18 |
| `LAOPGx` | Laopu Gold xStock | 6181 | Backed | 18 |
| `LASRon` | nLIGHT (Ondo Tokenized) | LASR | Ondo Global Markets | 18 |
| `LDOSx` | Leidos xStock | LDOS | Backed | 18 |
| `LDOx` | Leonardo xStock | LDOM | Backed | 18 |
| `LEAx` | Lear xStock | LEA | Backed | 18 |
| `LECOon` | Lincoln Electric (Ondo Tokenized) | LECO | Ondo Global Markets | 18 |
| `LECOx` | Lincoln Electric xStock | LECO | Backed | 18 |
| `LEMBon` | iShares J.P. Morgan EM Local Currency Bond ETF (Ondo Tokenized) | LEMB | Ondo Global Markets | 18 |
| `LENx` | Lennar xStock | LEN | Backed | 18 |
| `LFUSx` | Littelfuse xStock | LFUS | Backed | 18 |
| `LGENx` | Legal & General xStock | LGENL | Backed | 18 |
| `LHXx` | L3Harris Technologies xStock | LHX | Backed | 18 |
| `LIIx` | Lennox International xStock | LII | Backed | 18 |
| `LINEx` | Lineage xStock | LINE | Backed | 18 |
| `LINon` | Linde plc (Ondo Tokenized) | LIN | Ondo Global Markets | 18 |
| `LINx` | Linde xStock | LIN | Backed | 18 |
| `LITEon` | Lumentum Holdings (Ondo Tokenized) | LITE | Ondo Global Markets | 18 |
| `LITEx` | Lumentum Holdings Inc. xStock | LITE | Backed | 18 |
| `LITon` | Global X Lithium & Battery Tech ETF (Ondo Tokenized) | LIT | Ondo Global Markets | 18 |
| `LIon` | Li Auto (Ondo Tokenized) | LI | Ondo Global Markets | 18 |
| `LKQx` | LKQ xStock | LKQ | Backed | 18 |
| `LLOYx` | Lloyds Banking xStock | LLOYL | Backed | 18 |
| `LLYon` | Eli Lilly (Ondo Tokenized) | LLY | Ondo Global Markets | 18 |
| `LLYx` | Eli Lilly xStock | LLY | Backed | 18 |
| `LMTon` | Lockheed (Ondo Tokenized) | LMT | Ondo Global Markets | 18 |
| `LMTx` | Lockheed Martin xStock | LMT | Backed | 18 |
| `LNCx` | Lincoln National xStock | LNC | Backed | 18 |
| `LNGx` | Cheniere Energy xStock | LNG | Backed | 18 |
| `LNTx` | Alliant Energy xStock | LNT | Backed | 18 |
| `LOWon` | Lowe's (Ondo Tokenized) | LOW | Ondo Global Markets | 18 |
| `LOWx` | Lowe's Companies xStock | LOW | Backed | 18 |
| `LPLAx` | LPL Financial xStock | LPLA | Backed | 18 |
| `LPTHon` | LightPath Technologies (Ondo Tokenized) | LPTH | Ondo Global Markets | 18 |
| `LRCXon` | Lam Research (Ondo Tokenized) | LRCX | Ondo Global Markets | 18 |
| `LRCXx` | Lam Research Corporation xStock | LRCX | Backed | 18 |
| `LRx` | Legrand xStock | LRP | Backed | 18 |
| `LSCCon` | Lattice Semiconductor (Ondo Tokenized) | LSCC | Ondo Global Markets | 18 |
| `LSCCx` | Lattice Semiconductor xStock | LSCC | Backed | 18 |
| `LSEGx` | London Stock Exchange xStock | LSEGL | Backed | 18 |
| `LSTRx` | Landstar System xStock | LSTR | Backed | 18 |
| `LULUx` | lululemon xStock | LULU | Backed | 18 |
| `LUNRon` | Intuitive Machines (Ondo Tokenized) | LUNR | Ondo Global Markets | 18 |
| `LUNRx` | Intuitive Machines xStock | LUNR | Backed | 18 |
| `LUVx` | Southwest Airlines xStock | LUV | Backed | 18 |
| `LVSx` | Las Vegas Sands xStock | LVS | Backed | 18 |
| `LWLGon` | Lightwave Logic (Ondo Tokenized) | LWLG | Ondo Global Markets | 18 |
| `LWx` | Lamb Weston xStock | LW | Backed | 18 |
| `LYFTx` | Lyft xStock | LYFT | Backed | 18 |
| `LYTEx` | Roundhill Photonics & Optics ETF xStock | LYTE | Backed | 18 |
| `LYVx` | Live Nation Entertainment xStock | LYV | Backed | 18 |
| `Lx` | Loews xStock | L | Backed | 18 |
| `MAAx` | Mid-America Apartment Communities xStock | MAA | Backed | 18 |
| `MANHx` | Manhattan Associates xStock | MANH | Backed | 18 |
| `MARAon` | MARA Holdings (Ondo Tokenized) | MARA | Ondo Global Markets | 18 |
| `MARAx` | MARA xStock | MARA | Backed | 18 |
| `MARx` | Marriott International xStock | MAR | Backed | 18 |
| `MASx` | Masco xStock | MAS | Backed | 18 |
| `MAon` | Mastercard (Ondo Tokenized) | MA | Ondo Global Markets | 18 |
| `MAx` | Mastercard xStock | MA | Backed | 18 |
| `MBGLx` | Mobility Global xStock | MBGL | Backed | 18 |
| `MBGx` | Mercedes-Benz xStock | MBGD | Backed | 18 |
| `MBLYon` | Mobileye Global (Ondo Tokenized) | MBLY | Ondo Global Markets | 18 |
| `MCDon` | McDonald's (Ondo Tokenized) | MCD | Ondo Global Markets | 18 |
| `MCDx` | McDonald's xStock | MCD | Backed | 18 |
| `MCHPx` | Microchip Technology xStock | MCHP | Backed | 18 |
| `MCKx` | McKesson xStock | MCK | Backed | 18 |
| `MCOx` | Moody's xStock | MCO | Backed | 18 |
| `MC_FRx` | LVMH Moet Hennessy Louis Vuitton xStock | MCP | Backed | 18 |
| `MDBx` | MongoDB xStock | MDB | Backed | 18 |
| `MDGLx` | Madrigal Pharmaceuticals xStock | MDGL | Backed | 18 |
| `MDLNx` | Medline xStock | MDLN | Backed | 18 |
| `MDLZx` | Mondelez International xStock | MDLZ | Backed | 18 |
| `MDTx` | Medtronic xStock | MDT | Backed | 18 |
| `MEDPx` | Medpace xStock | MEDP | Backed | 18 |
| `MEITx` | Meituan xStock | 3690 | Backed | 18 |
| `MEIon` | Methode Electronics (Ondo Tokenized) | MEI | Ondo Global Markets | 18 |
| `MELIon` | MercadoLibre (Ondo Tokenized) | MELI | Ondo Global Markets | 18 |
| `METAon` | Meta Platforms (Ondo Tokenized) | META | Ondo Global Markets | 18 |
| `METAx` | Meta xStock | META | Backed | 18 |
| `METCx` | Ramaco Resources xStock | METC | Backed | 18 |
| `METx` | MetLife xStock | MET | Backed | 18 |
| `MGMx` | MGM Resorts International xStock | MGM | Backed | 18 |
| `MHKx` | Mohawk Industries xStock | MHK | Backed | 18 |
| `MIDDx` | The Middleby xStock | MIDD | Backed | 18 |
| `MIXUx` | Mixue xStock | 2097 | Backed | 18 |
| `MKCx` | McCormick xStock | MKC | Backed | 18 |
| `MKLx` | Markel xStock | MKL | Backed | 18 |
| `MKSIon` | MKS Inc. (Ondo Tokenized) | MKSI | Ondo Global Markets | 18 |
| `MKSIx` | MKS xStock | MKSI | Backed | 18 |
| `MKS_GBx` | Marks & Spencer xStock | MKSL | Backed | 18 |
| `MKTXx` | MarketAxess xStock | MKTX | Backed | 18 |
| `MLIx` | Mueller Industries xStock | MLI | Backed | 18 |
| `MLMx` | Martin Marietta Materials xStock | MLM | Backed | 18 |
| `MLx` | Michelin xStock | MLP | Backed | 18 |
| `MMGx` | MMG xStock | 1208 | Backed | 18 |
| `MMMx` | 3M xStock | MMM | Backed | 18 |
| `MNDIx` | Mondi xStock | MNDIL | Backed | 18 |
| `MNGx` | M&G xStock | MNGL | Backed | 18 |
| `MODx` | Modine Manufacturing xStock | MOD | Backed | 18 |
| `MOOx` | VanEck Agribusiness ETF xStock | MOO | Backed | 18 |
| `MORNx` | Morningstar xStock | MORN | Backed | 18 |
| `MOSx` | The Mosaic xStock | MOS | Backed | 18 |
| `MOx` | Altria xStock | MO | Backed | 18 |
| `MPCx` | Marathon Petroleum xStock | MPC | Backed | 18 |
| `MPS` | Mt Pelerin Shares | MPS | Mt Pelerin | 0 |
| `MPWRx` | Monolithic Power Systems xStock | MPWR | Backed | 18 |
| `MPon` | MP Materials (Ondo Tokenized) | MP | Ondo Global Markets | 18 |
| `MPx` | MP Materials xStock | MP | Backed | 18 |
| `MRK_DEx` | Merck KGaA xStock | MRKD | Backed | 18 |
| `MRKon` | Merck (Ondo Tokenized) | MRK | Ondo Global Markets | 18 |
| `MRKx` | Merck xStock | MRK | Backed | 18 |
| `MRNAon` | Moderna (Ondo Tokenized) | MRNA | Ondo Global Markets | 18 |
| `MRNAx` | Moderna xStock | MRNA | Backed | 18 |
| `MROx` | Melrose Industries xStock | MROL | Backed | 18 |
| `MRSHx` | Marsh xStock | MRSH | Backed | 18 |
| `MRVLon` | Marvell Technology (Ondo Tokenized) | MRVL | Ondo Global Markets | 18 |
| `MRVLx` | Marvell xStock | MRVL | Backed | 18 |
| `MSAx` | MSA Safety xStock | MSA | Backed | 18 |
| `MSCIx` | MSCI xStock | MSCI | Backed | 18 |
| `MSFTon` | Microsoft (Ondo Tokenized) | MSFT | Ondo Global Markets | 18 |
| `MSFTx` | Microsoft xStock | MSFT | Backed | 18 |
| `MSGSx` | Madison Square Garden Sports xStock | MSGS | Backed | 18 |
| `MSIx` | Motorola Solutions xStock | MSI | Backed | 18 |
| `MSMx` | MSC Industrial Direct xStock | MSM | Backed | 18 |
| `MSTRon` | MicroStrategy (Ondo Tokenized) | MSTR | Ondo Global Markets | 18 |
| `MSTRx` | MicroStrategy xStock | MSTR | Backed | 18 |
| `MSx` | Morgan Stanley xStock | MS | Backed | 18 |
| `MTBx` | M&T Bank xStock | MTB | Backed | 18 |
| `MTCHx` | Match xStock | MTCH | Backed | 18 |
| `MTDRx` | Matador Resources xStock | MTDR | Backed | 18 |
| `MTDx` | Mettler-Toledo International xStock | MTD | Backed | 18 |
| `MTGx` | MGIC Investment xStock | MTG | Backed | 18 |
| `MTNx` | Vail Resorts xStock | MTN | Backed | 18 |
| `MTRCPx` | MTR xStock | 66 | Backed | 18 |
| `MTSIon` | MACOM Technology Solutions Holdings (Ondo Tokenized) | MTSI | Ondo Global Markets | 18 |
| `MTSIx` | MACOM Technology Solutions xStock | MTSI | Backed | 18 |
| `MTX_DEx` | MTU Aero Engines xStock | MTXD | Backed | 18 |
| `MTZon` | MasTec (Ondo Tokenized) | MTZ | Ondo Global Markets | 18 |
| `MTZx` | MasTec xStock | MTZ | Backed | 18 |
| `MTx` | ArcelorMittal xStock | MTA | Backed | 18 |
| `MUSAx` | Murphy USA xStock | MUSA | Backed | 18 |
| `MUUx` | Micron 2x Long ETF xStock | MUU | Backed | 18 |
| `MUV2x` | Munchener Ruckversicherungs-Gesellschaft xStock | MUV2D | Backed | 18 |
| `MUon` | Micron Technology (Ondo Tokenized) | MU | Ondo Global Markets | 18 |
| `MUx` | Micron Technology xStock | MU | Backed | 18 |
| `MVLLx` | Marvell 2x Long ETF xStock | MVLL | Backed | 18 |
| `MXLon` | MaxLinear (Ondo Tokenized) | MXL | Ondo Global Markets | 18 |
| `MYRGon` | MYR Group (Ondo Tokenized) | MYRG | Ondo Global Markets | 18 |
| `Mx` | Macy's xStock | M | Backed | 18 |
| `NATon` | Nordic American Tankers (Ondo Tokenized) | NAT | Ondo Global Markets | 18 |
| `NBISon` | Nebius Group (Ondo Tokenized) | NBIS | Ondo Global Markets | 18 |
| `NBISx` | Nebius xStock | NBIS | Backed | 18 |
| `NBIXx` | Neurocrine Biosciences xStock | NBIX | Backed | 18 |
| `NCLHx` | Norwegian Cruise Line xStock | NCLH | Backed | 18 |
| `NDAQx` | Nasdaq Inc. xStock | NDAQ | Backed | 18 |
| `NDA_FIx` | Nordea Bank Abp xStock | NDAH | Backed | 18 |
| `NDSNx` | Nordson xStock | NDSN | Backed | 18 |
| `NEARon` | iShares Short Duration Bond Active ETF (Ondo Tokenized) | NEAR | Ondo Global Markets | 18 |
| `NEEon` | NextEra Energy (Ondo Tokenized) | NEE | Ondo Global Markets | 18 |
| `NEEx` | NextEra Energy xStock | NEE | Backed | 18 |
| `NEMon` | Newmont (Ondo Tokenized) | NEM | Ondo Global Markets | 18 |
| `NEMx` | Newmont xStock | NEM | Backed | 18 |
| `NESTEx` | Neste xStock | NESTEH | Backed | 18 |
| `NETon` | Cloudflare (Ondo Tokenized) | NET | Ondo Global Markets | 18 |
| `NETx` | Cloudflare xStock | NET | Backed | 18 |
| `NEUx` | NewMarket xStock | NEU | Backed | 18 |
| `NFGx` | National Fuel Gas xStock | NFG | Backed | 18 |
| `NFLXon` | Netflix (Ondo Tokenized) | NFLX | Ondo Global Markets | 18 |
| `NFLXx` | Netflix xStock | NFLX | Backed | 18 |
| `NG_GBx` | National Grid xStock | NGL | Backed | 18 |
| `NIKLon` | Sprott Nickel Miners ETF (Ondo Tokenized) | NIKL | Ondo Global Markets | 18 |
| `NIOon` | NIO (Ondo Tokenized) | NIO | Ondo Global Markets | 18 |
| `NIx` | NiSource xStock | NI | Backed | 18 |
| `NKEon` | Nike (Ondo Tokenized) | NKE | Ondo Global Markets | 18 |
| `NKEx` | Nike xStock | NKE | Backed | 18 |
| `NLRx` | VanEck Uranium and Nuclear xStock | NLR | Backed | 18 |
| `NLYx` | Annaly Capital Management xStock | NLY | Backed | 18 |
| `NNEon` | NANO Nuclear Energy (Ondo Tokenized) | NNE | Ondo Global Markets | 18 |
| `NNNx` | NNN REIT xStock | NNN | Backed | 18 |
| `NN_NLx` | NN xStock | NNA | Backed | 18 |
| `NOCon` | Northrop Grumman (Ondo Tokenized) | NOC | Ondo Global Markets | 18 |
| `NOCx` | Northrop Grumman xStock | NOC | Backed | 18 |
| `NOKIAx` | Nokia xStock | NOKIAH | Backed | 18 |
| `NOKon` | Nokia (Ondo Tokenized) | NOK | Ondo Global Markets | 18 |
| `NONGx` | Nongfu Spring xStock | 9633 | Backed | 18 |
| `NOVx` | NOV xStock | NOV | Backed | 18 |
| `NOWon` | ServiceNow (Ondo Tokenized) | NOW | Ondo Global Markets | 18 |
| `NOWx` | ServiceNow xStock | NOW | Backed | 18 |
| `NRGx` | NRG Energy xStock | NRG | Backed | 18 |
| `NSCx` | Norfolk Southern xStock | NSC | Backed | 18 |
| `NTAPx` | NetApp xStock | NTAP | Backed | 18 |
| `NTESon` | NetEase (Ondo Tokenized) | NTES | Ondo Global Markets | 18 |
| `NTESx` | NetEase xStock | NTES | Backed | 18 |
| `NTNXx` | Nutanix xStock | NTNX | Backed | 18 |
| `NTRAx` | Natera xStock | NTRA | Backed | 18 |
| `NTRSx` | Northern Trust xStock | NTRS | Backed | 18 |
| `NUEon` | Nucor (Ondo Tokenized) | NUE | Ondo Global Markets | 18 |
| `NUEx` | Nucor xStock | NUE | Backed | 18 |
| `NVDAon` | NVIDIA (Ondo Tokenized) | NVDA | Ondo Global Markets | 18 |
| `NVDAx` | NVIDIA xStock | NVDA | Backed | 18 |
| `NVDLx` | GraniteShares 2x Long NVDA Daily ETF xStock | NVDL | Backed | 18 |
| `NVMIon` | Nova (Ondo Tokenized) | NVMI | Ondo Global Markets | 18 |
| `NVOon` | Novo Nordisk (Ondo Tokenized) | NVO | Ondo Global Markets | 18 |
| `NVOx` | Novo Nordisk xStock | NVO | Backed | 18 |
| `NVRx` | NVR xStock | NVR | Backed | 18 |
| `NVTSon` | Navitas Semiconductor (Ondo Tokenized) | NVTS | Ondo Global Markets | 18 |
| `NVTon` | nVent Electric (Ondo Tokenized) | NVT | Ondo Global Markets | 18 |
| `NWGx` | NatWest xStock | NWGL | Backed | 18 |
| `NWSAx` | News xStock | NWSA | Backed | 18 |
| `NWSx` | News xStock | NWS | Backed | 18 |
| `NXSTx` | Nexstar Media xStock | NXST | Backed | 18 |
| `NXT_GBx` | Next xStock | NXTL | Backed | 18 |
| `NYTx` | New York Times xStock | NYT | Backed | 18 |
| `OCx` | Owens-Corning xStock | OC | Backed | 18 |
| `ODFLx` | Old Dominion Freight Line xStock | ODFL | Backed | 18 |
| `OGEx` | OGE Energy xStock | OGE | Backed | 18 |
| `OHIx` | Omega Healthcare Investors xStock | OHI | Backed | 18 |
| `OIHon` | VanEck Oil Services ETF (Ondo Tokenized) | OIH | Ondo Global Markets | 18 |
| `OIIon` | Oceaneering International (Ondo Tokenized) | OII | Ondo Global Markets | 18 |
| `OKEx` | ONEOK xStock | OKE | Backed | 18 |
| `OKLOon` | Oklo (Ondo Tokenized) | OKLO | Ondo Global Markets | 18 |
| `OKLOx` | Oklo xStock | OKLO | Backed | 18 |
| `OKTAx` | Okta xStock | OKTA | Backed | 18 |
| `OMCx` | Omnicom xStock | OMC | Backed | 18 |
| `OMFx` | OneMain xStock | OMF | Backed | 18 |
| `ONDSon` | Ondas Holdings (Ondo Tokenized) | ONDS | Ondo Global Markets | 18 |
| `ONDSx` | Ondas xStock | ONDS | Backed | 18 |
| `ONTOon` | Onto Innovation (Ondo Tokenized) | ONTO | Ondo Global Markets | 18 |
| `ONTOx` | Onto Innovation xStock | ONTO | Backed | 18 |
| `ONon` | ON Semiconductor (Ondo Tokenized) | ON | Ondo Global Markets | 18 |
| `ONx` | ON Semiconductor xStock | ON | Backed | 18 |
| `OPENon` | Opendoor Technologies (Ondo Tokenized) | OPEN | Ondo Global Markets | 18 |
| `OPENx` | OPEN xStock | OPEN | Backed | 18 |
| `OPRAon` | Opera (Ondo Tokenized) | OPRA | Ondo Global Markets | 18 |
| `ORA_FRx` | Orange xStock | ORAP | Backed | 18 |
| `ORBXon` | Global X Space Tech ETF (Ondo Tokenized) | ORBX | Ondo Global Markets | 18 |
| `ORCLon` | Oracle (Ondo Tokenized) | ORCL | Ondo Global Markets | 18 |
| `ORCLx` | Oracle xStock | ORCL | Backed | 18 |
| `ORIx` | Old Republic International xStock | ORI | Backed | 18 |
| `ORLYx` | O'Reilly Automotive xStock | ORLY | Backed | 18 |
| `OR_FRx` | L'Oreal xStock | ORP | Backed | 18 |
| `OSCRon` | Oscar Health (Ondo Tokenized) | OSCR | Ondo Global Markets | 18 |
| `OSCRx` | Oscar Health xStock | OSCR | Backed | 18 |
| `OSKx` | Oshkosh xStock | OSK | Backed | 18 |
| `OTISx` | Otis Worldwide xStock | OTIS | Backed | 18 |
| `OUSTon` | Ouster (Ondo Tokenized) | OUST | Ondo Global Markets | 18 |
| `OUSTx` | Ouster xStock | OUST | Backed | 18 |
| `OVVx` | Ovintiv xStock | OVV | Backed | 18 |
| `OWLx` | Blue Owl Capital xStock | OWL | Backed | 18 |
| `OXYon` | Occidental Petroleum (Ondo Tokenized) | OXY | Ondo Global Markets | 18 |
| `OXYx` | Occidental Petroleum xStock | OXY | Backed | 18 |
| `OZKx` | Bank OZK xStock | OZK | Backed | 18 |
| `Ox` | Realty Income xStock | O | Backed | 18 |
| `PAGx` | Penske Automotive xStock | PAG | Backed | 18 |
| `PALLon` | abrdn Physical Palladium Shares ETF (Ondo Tokenized) | PALL | Ondo Global Markets | 18 |
| `PALLx` | abrdn Physical Palladium Shares xStock | PALL | Backed | 18 |
| `PANWon` | Palo Alto Networks (Ondo Tokenized) | PANW | Ondo Global Markets | 18 |
| `PANWx` | Palo Alto Networks xStock | PANW | Backed | 18 |
| `PATHx` | UiPath xStock | PATH | Backed | 18 |
| `PAVEon` | Global X US Infrastructure Development ETF (Ondo Tokenized) | PAVE | Ondo Global Markets | 18 |
| `PAYCx` | Paycom Software xStock | PAYC | Backed | 18 |
| `PAYXx` | Paychex xStock | PAYX | Backed | 18 |
| `PBRon` | Petrobras (Ondo Tokenized) | PBR | Ondo Global Markets | 18 |
| `PCARx` | PACCAR xStock | PCAR | Backed | 18 |
| `PCGon` | PG&E (Ondo Tokenized) | PCG | Ondo Global Markets | 18 |
| `PCGx` | PG&E xStock | PCG | Backed | 18 |
| `PCORx` | Procore Technologies xStock | PCOR | Backed | 18 |
| `PCTYx` | Paylocity xStock | PCTY | Backed | 18 |
| `PCTx` | PureCycle Technologies xStock | PCT | Backed | 18 |
| `PDBCon` | Invesco Optimum Yld Dvsfd Cmd Str No K-1 ETF (Ondo Tokenized) | PDBC | Ondo Global Markets | 18 |
| `PDDon` | PDD Holdings (Ondo Tokenized) | PDD | Ondo Global Markets | 18 |
| `PDDx` | PDD xStock | PDD | Backed | 18 |
| `PEGAx` | Pegasystems xStock | PEGA | Backed | 18 |
| `PEGx` | Public Service Enterprise xStock | PEG | Backed | 18 |
| `PENGon` | Penguin Solutions (Ondo Tokenized) | PENG | Ondo Global Markets | 18 |
| `PENGx` | Penguin Solutions xStock | PENG | Backed | 18 |
| `PENx` | Penumbra xStock | PEN | Backed | 18 |
| `PEPon` | PepsiCo (Ondo Tokenized) | PEP | Ondo Global Markets | 18 |
| `PEPx` | PepsiCo xStock | PEP | Backed | 18 |
| `PFEon` | Pfizer (Ondo Tokenized) | PFE | Ondo Global Markets | 18 |
| `PFEx` | Pfizer xStock | PFE | Backed | 18 |
| `PFGCx` | Performance Food xStock | PFGC | Backed | 18 |
| `PFGx` | Principal Financial xStock | PFG | Backed | 18 |
| `PGRx` | Progressive xStock | PGR | Backed | 18 |
| `PGon` | Procter & Gamble (Ondo Tokenized) | PG | Ondo Global Markets | 18 |
| `PGx` | Procter & Gamble xStock | PG | Backed | 18 |
| `PHIAx` | Koninklijke Philips xStock | PHIAA | Backed | 18 |
| `PHx` | Parker Hannifin xStock | PH | Backed | 18 |
| `PICCx` | PICC Property and Casualty xStock | 2328 | Backed | 18 |
| `PICOx` | Ping An Insurance Group Co. of China xStock | 2318 | Backed | 18 |
| `PINSon` | Pinterest (Ondo Tokenized) | PINS | Ondo Global Markets | 18 |
| `PINSx` | Pinterest xStock | PINS | Backed | 18 |
| `PKGx` | Packaging Corp of America xStock | PKG | Backed | 18 |
| `PLDx` | Prologis xStock | PLD | Backed | 18 |
| `PLTRon` | Palantir Technologies (Ondo Tokenized) | PLTR | Ondo Global Markets | 18 |
| `PLTRx` | Palantir xStock | PLTR | Backed | 18 |
| `PLUGon` | Plug Power (Ondo Tokenized) | PLUG | Ondo Global Markets | 18 |
| `PLon` | Planet Labs (Ondo Tokenized) | PL | Ondo Global Markets | 18 |
| `PLx` | Planet Labs xStock | PL | Backed | 18 |
| `PMx` | Philip Morris xStock | PM | Backed | 18 |
| `PNCx` | PNC Financial Services xStock | PNC | Backed | 18 |
| `PNFPx` | Pinnacle Financial Partners xStock | PNFP | Backed | 18 |
| `PNWx` | Pinnacle West Capital xStock | PNW | Backed | 18 |
| `PODDx` | Insulet xStock | PODD | Backed | 18 |
| `POETx` | POET Technologies xStock | POET | Backed | 18 |
| `POOLx` | Pool xStock | POOL | Backed | 18 |
| `POPMTx` | Pop Mart International xStock | 9992 | Backed | 18 |
| `POWIon` | Power Integrations (Ondo Tokenized) | POWI | Ondo Global Markets | 18 |
| `POWLon` | Powell Industries (Ondo Tokenized) | POWL | Ondo Global Markets | 18 |
| `POWLx` | Powell Industries xStock | POWL | Backed | 18 |
| `PPCx` | Pilgrims Pride xStock | PPC | Backed | 18 |
| `PPGx` | PPG Industries xStock | PPG | Backed | 18 |
| `PPLTon` | abrdn Physical Platinum Shares ETF (Ondo Tokenized) | PPLT | Ondo Global Markets | 18 |
| `PPLTx` | abrdn Physical Platinum Shares xStock | PPLT | Backed | 18 |
| `PPLx` | PPL xStock | PPL | Backed | 18 |
| `PRADx` | Prada xStock | 1913 | Backed | 18 |
| `PRIMon` | Primoris Services (Ondo Tokenized) | PRIM | Ondo Global Markets | 18 |
| `PRIx` | Primerica xStock | PRI | Backed | 18 |
| `PRMBx` | Primo Brands xStock | PRMB | Backed | 18 |
| `PRU_GBx` | Prudential xStock | PRUL | Backed | 18 |
| `PRUx` | Prudential Financial xStock | PRU | Backed | 18 |
| `PRYx` | Prysmian xStock | PRYM | Backed | 18 |
| `PRx` | Permian Resources xStock | PR | Backed | 18 |
| `PSAx` | Public Storage xStock | PSA | Backed | 18 |
| `PSBOCx` | Postal Savings Bank Of China xStock | 1658 | Backed | 18 |
| `PSN_GBx` | Persimmon xStock | PSNL | Backed | 18 |
| `PSNx` | Parsons xStock | PSN | Backed | 18 |
| `PSONx` | Pearson xStock | PSONL | Backed | 18 |
| `PSQon` | ProShares Short QQQ (Ondo Tokenized) | PSQ | Ondo Global Markets | 18 |
| `PST_ITx` | Poste Italiane xStock | PSTM | Backed | 18 |
| `PSXx` | Phillips 66 xStock | PSX | Backed | 18 |
| `PTCx` | PTC xStock | PTC | Backed | 18 |
| `PUB_FRx` | Publicis Groupe xStock | PUBP | Backed | 18 |
| `PURRon` | Hyperliquid Strategies (Ondo Tokenized) | PURR | Ondo Global Markets | 18 |
| `PURRx` | Hyperliquid Strategies xStock | PURR | Backed | 18 |
| `PWAHLx` | Power Assets xStock | 6 | Backed | 18 |
| `PWRon` | Quanta Services (Ondo Tokenized) | PWR | Ondo Global Markets | 18 |
| `PWRx` | Quanta Services, Inc. xStock | PWR | Backed | 18 |
| `PYPLon` | PayPal (Ondo Tokenized) | PYPL | Ondo Global Markets | 18 |
| `PYPLx` | PayPal xStock | PYPL | Backed | 18 |
| `Px` | Everpure xStock | P | Backed | 18 |
| `QBTSon` | D-Wave Quantum (Ondo Tokenized) | QBTS | Ondo Global Markets | 18 |
| `QCOMon` | Qualcomm (Ondo Tokenized) | QCOM | Ondo Global Markets | 18 |
| `QCOMx` | Qualcomm xStock | QCOM | Backed | 18 |
| `QLTAon` | iShares Aaa - A Rated Corporate Bond ETF (Ondo Tokenized) | QLTA | Ondo Global Markets | 18 |
| `QNTx` | Quantinuum xStock | QNT | Backed | 18 |
| `QQQon` | Invesco QQQ (Ondo Tokenized) | QQQ | Ondo Global Markets | 18 |
| `QQQx` | Nasdaq xStock | QQQ | Backed | 18 |
| `QQ_GBx` | QinetiQ xStock | QQL | Backed | 18 |
| `QRVOx` | Qorvo xStock | QRVO | Backed | 18 |
| `QSRx` | Restaurant Brands International xStock | QSR | Backed | 18 |
| `QTUMon` | Defiance Quantum ETF (Ondo Tokenized) | QTUM | Ondo Global Markets | 18 |
| `QUBTon` | Quantum Computing (Ondo Tokenized) | QUBT | Ondo Global Markets | 18 |
| `QUBTx` | Quantum Computing xStock | QUBT | Backed | 18 |
| `QUREx` | uniQure xStock | QURE | Backed | 18 |
| `QYLDon` | Global X NASDAQ 100 Covered Call ETF (Ondo Tokenized) | QYLD | Ondo Global Markets | 18 |
| `QYLDx` | Global X NASDAQ 100 Covered Call ETF xStock | QYLD | Backed | 18 |
| `Qx` | Qnity Electronics xStock | Q | Backed | 18 |
| `RAMx` | Roundhill T-REX 2X Long DRAM Daily Target ETF xStock | RAM | Backed | 18 |
| `RBAx` | RB Global xStock | RBA | Backed | 18 |
| `RBLXx` | Roblox xStock | RBLX | Backed | 18 |
| `RBRKx` | Rubrik xStock | RBRK | Backed | 18 |
| `RCATx` | Red Cat xStock | RCAT | Backed | 18 |
| `RDDTon` | Reddit (Ondo Tokenized) | RDDT | Ondo Global Markets | 18 |
| `RDDTx` | Reddit xStock | RDDT | Backed | 18 |
| `RDWon` | Redwire (Ondo Tokenized) | RDW | Ondo Global Markets | 18 |
| `RDWx` | Redwire xStock | RDW | Backed | 18 |
| `REGNon` | Regeneron Pharmaceuticals (Ondo Tokenized) | REGN | Ondo Global Markets | 18 |
| `REGNx` | Regeneron Pharmaceuticals xStock | REGN | Backed | 18 |
| `REGx` | Regency Centers xStock | REG | Backed | 18 |
| `REL_GBx` | Relx xStock | RELL | Backed | 18 |
| `REMXon` | VanEck Rare Earth and Strategic Metals ETF (Ondo Tokenized) | REMX | Ondo Global Markets | 18 |
| `REPx` | Repsol xStock | REPE | Backed | 18 |
| `REXRx` | Rexford Industrial Realty xStock | REXR | Backed | 18 |
| `REYNx` | Reynolds Consumer Products xStock | REYN | Backed | 18 |
| `RFx` | Regions Financial xStock | RF | Backed | 18 |
| `RGAx` | Reinsurance Group of America xStock | RGA | Backed | 18 |
| `RGENx` | Repligen xStock | RGEN | Backed | 18 |
| `RGLDx` | Royal Gold xStock | RGLD | Backed | 18 |
| `RGTIon` | Rigetti Computing (Ondo Tokenized) | RGTI | Ondo Global Markets | 18 |
| `RHMx` | Rheinmetall xStock | RHMD | Backed | 18 |
| `RIOTon` | Riot Platforms (Ondo Tokenized) | RIOT | Ondo Global Markets | 18 |
| `RIOTx` | Riot Platforms xStock | RIOT | Backed | 18 |
| `RIO_GBx` | Rio Tinto xStock | RIOL | Backed | 18 |
| `RITMx` | Rithm Capital xStock | RITM | Backed | 18 |
| `RIVNon` | Rivian Automotive (Ondo Tokenized) | RIVN | Ondo Global Markets | 18 |
| `RIVNx` | Rivian Automotive xStock | RIVN | Backed | 18 |
| `RJFx` | Raymond James Financial xStock | RJF | Backed | 18 |
| `RKLBon` | Rocket Lab (Ondo Tokenized) | RKLB | Ondo Global Markets | 18 |
| `RKLBx` | Rocket Lab xStock | RKLB | Backed | 18 |
| `RKT_GBx` | Reckitt Benckiser xStock | RKTL | Backed | 18 |
| `RLIx` | RLI xStock | RLI | Backed | 18 |
| `RLx` | Ralph Lauren xStock | RL | Backed | 18 |
| `RMBSon` | Rambus (Ondo Tokenized) | RMBS | Ondo Global Markets | 18 |
| `RMBSx` | Rambus xStock | RMBS | Backed | 18 |
| `RMDx` | ResMed xStock | RMD | Backed | 18 |
| `RMSx` | Hermes International xStock | RMSP | Backed | 18 |
| `RMVx` | Rightmove xStock | RMVL | Backed | 18 |
| `RNGx` | RingCentral xStock | RNG | Backed | 18 |
| `RNRx` | RenaissanceRe xStock | RNR | Backed | 18 |
| `ROIVx` | Roivant Sciences xStock | ROIV | Backed | 18 |
| `ROKUx` | Roku xStock | ROKU | Backed | 18 |
| `ROKon` | Rockwell Automation (Ondo Tokenized) | ROK | Ondo Global Markets | 18 |
| `ROKx` | Rockwell Automation xStock | ROK | Backed | 18 |
| `ROLx` | Rollins xStock | ROL | Backed | 18 |
| `ROPx` | Roper Technologies xStock | ROP | Backed | 18 |
| `ROSTx` | Ross Stores xStock | ROST | Backed | 18 |
| `RPMx` | RPM International xStock | RPM | Backed | 18 |
| `RRCx` | Range Resources xStock | RRC | Backed | 18 |
| `RRXx` | Regal Rexnord xStock | RRX | Backed | 18 |
| `RR_GBx` | Rolls-Royce xStock | RRL | Backed | 18 |
| `RS1_GBx` | RS xStock | RS1L | Backed | 18 |
| `RSGx` | Republic Services xStock | RSG | Backed | 18 |
| `RSx` | Reliance xStock | RS | Backed | 18 |
| `RTOx` | Rentokil Initial xStock | RTOL | Backed | 18 |
| `RTXon` | RTX (Ondo Tokenized) | RTX | Ondo Global Markets | 18 |
| `RTXx` | RTX xStock | RTX | Backed | 18 |
| `RVMDx` | Revolution Medicines xStock | RVMD | Backed | 18 |
| `RVTYx` | Revvity xStock | RVTY | Backed | 18 |
| `RWEx` | RWE Class A xStock | RWED | Backed | 18 |
| `RXRXon` | Recursion Pharmaceuticals (Ondo Tokenized) | RXRX | Ondo Global Markets | 18 |
| `RYANx` | Ryan Specialty xStock | RYAN | Backed | 18 |
| `RYNx` | Rayonier xStock | RYN | Backed | 18 |
| `Rx` | Ryder System xStock | R | Backed | 18 |
| `SAFx` | Safran xStock | SAFP | Backed | 18 |
| `SAIAx` | Saia xStock | SAIA | Backed | 18 |
| `SAICx` | Science Applications International xStock | SAIC | Backed | 18 |
| `SAILx` | SailPoint xStock | SAIL | Backed | 18 |
| `SAMPOx` | Sampo Class A xStock | SAMPOH | Backed | 18 |
| `SANMx` | Sanmina xStock | SANM | Backed | 18 |
| `SAN_ESx` | Banco Santander xStock | SANE | Backed | 18 |
| `SAN_FRx` | Sanofi xStock | SANP | Backed | 18 |
| `SAPon` | SAP (Ondo Tokenized) | SAP | Ondo Global Markets | 18 |
| `SAPx` | SAP xStock | SAPD | Backed | 18 |
| `SAROx` | StandardAero xStock | SARO | Backed | 18 |
| `SATAon` | Strive Preferred (Ondo Tokenized) | SATA | Ondo Global Markets | 18 |
| `SATAx` | Strive, Inc. Series A Preferred xStock | SATA | Backed | 18 |
| `SBACx` | SBA Communications xStock | SBAC | Backed | 18 |
| `SBETon` | SharpLink Gaming (Ondo Tokenized) | SBET | Ondo Global Markets | 18 |
| `SBETx` | SharpLink Gaming xStock | SBET | Backed | 18 |
| `SBRYx` | Sainsbury xStock | SBRYL | Backed | 18 |
| `SBUXon` | Starbucks (Ondo Tokenized) | SBUX | Ondo Global Markets | 18 |
| `SBUXx` | Starbucks xStock | SBUX | Backed | 18 |
| `SCCOon` | Southern Copper (Ondo Tokenized) | SCCO | Ondo Global Markets | 18 |
| `SCCOx` | Southern Copper xStock | SCCO | Backed | 18 |
| `SCHFx` | Schwab International Equity xStock | SCHF | Backed | 18 |
| `SCHWon` | Charles Schwab (Ondo Tokenized) | SCHW | Ondo Global Markets | 18 |
| `SCHWx` | Charles Schwab xStock | SCHW | Backed | 18 |
| `SCIx` | Service Corp International xStock | SCI | Backed | 18 |
| `SCT_GBx` | Softcat xStock | SCTL | Backed | 18 |
| `SECUon` | iShares Securitized Income Active ETF (Ondo Tokenized) | SECU | Ondo Global Markets | 18 |
| `SEDGon` | SolarEdge Technologies (Ondo Tokenized) | SEDG | Ondo Global Markets | 18 |
| `SEICx` | SEI Investments xStock | SEIC | Backed | 18 |
| `SFDx` | Smithfield Foods xStock | SFD | Backed | 18 |
| `SFMx` | Sprouts Farmers Market xStock | SFM | Backed | 18 |
| `SFx` | Stifel Financial xStock | SF | Backed | 18 |
| `SGE_GBx` | Sage xStock | SGEL | Backed | 18 |
| `SGIx` | Somnigroup International xStock | SGI | Backed | 18 |
| `SGOVon` | iShares 0-3 Month Treasury Bond ETF (Ondo Tokenized) | SGOV | Ondo Global Markets | 18 |
| `SGOVx` | iShares 0-3 Month Treasury Bond ETF xStock | SGOV | Backed | 18 |
| `SGOx` | Compagnie de Saint-Gobain xStock | SGOP | Backed | 18 |
| `SHAZx` | SharonAI xStock | SHAZ | Backed | 18 |
| `SHCx` | Sotera Health xStock | SHC | Backed | 18 |
| `SHEINx` | SHEIN xStock | 625 | Backed | 18 |
| `SHELx` | Shell xStock | SHELL | Backed | 18 |
| `SHLDon` | Global X Defense Tech ETF (Ondo Tokenized) | SHLD | Ondo Global Markets | 18 |
| `SHLDx` | Global X Defense Tech ETF xStock | SHLD | Backed | 18 |
| `SHLx` | Siemens Healthineers xStock | XETR:SHLD | Backed | 18 |
| `SHOPon` | Shopify (Ondo Tokenized) | SHOP | Ondo Global Markets | 18 |
| `SHOPx` | Shopify xStock | SHOP | Backed | 18 |
| `SHWx` | Sherwin-Williams xStock | SHW | Backed | 18 |
| `SHYon` | iShares 1-3 Year Treasury Bond ETF (Ondo Tokenized) | SHY | Ondo Global Markets | 18 |
| `SIEx` | Siemens xStock | SIED | Backed | 18 |
| `SILon` | Global X Silver Miners ETF (Ondo Tokenized) | SIL | Ondo Global Markets | 18 |
| `SIMOx` | Silicon Motion Technology xStock | SIMO | Backed | 18 |
| `SINOTx` | Sinotruk xStock | 3808 | Backed | 18 |
| `SINOx` | Sino Land xStock | 83 | Backed | 18 |
| `SIRIx` | Sirius XM xStock | SIRI | Backed | 18 |
| `SITCx` | SITC International xStock | 1308 | Backed | 18 |
| `SJMx` | J.M. Smucker xStock | SJM | Backed | 18 |
| `SKDDx` | GraniteShares 2x Short SK Hynix Daily ETF xStock | SKDD | Backed | 18 |
| `SKHYon` | SK Hynix (Ondo Tokenized) | SKHY | Ondo Global Markets | 18 |
| `SKHYx` | SK hynix xStock | SKHY | Backed | 18 |
| `SKUUx` | GraniteShares 2x Long SK Hynix Daily ETF xStock | SKUU | Backed | 18 |
| `SLBon` | SLB (Ondo Tokenized) | SLB | Ondo Global Markets | 18 |
| `SLMTx` | Brera xStock | SLMT | Backed | 18 |
| `SLVon` | iShares Silver Trust (Ondo Tokenized) | SLV | Ondo Global Markets | 18 |
| `SLVx` | iShares Silver Trust xStock | SLV | Backed | 18 |
| `SMCIon` | Super Micro Computer (Ondo Tokenized) | SMCI | Ondo Global Markets | 18 |
| `SMCIx` | Super Micro Computer, Inc. xStock | SMCI | Backed | 18 |
| `SMHx` | VanEck Semiconductor ETF xStock | SMH | Backed | 18 |
| `SMIN_GBx` | Smiths xStock | SMINL | Backed | 18 |
| `SMMTx` | Summit Therapeutics xStock | SMMT | Backed | 18 |
| `SMOIHx` | Smoore International xStock | 6969 | Backed | 18 |
| `SMRon` | NuScale Power (Ondo Tokenized) | SMR | Ondo Global Markets | 18 |
| `SMRx` | NuScale Power Corporation xStock | SMR | Backed | 18 |
| `SMTCx` | Semtech xStock | SMTC | Backed | 18 |
| `SNAPon` | Snap (Ondo Tokenized) | SNAP | Ondo Global Markets | 18 |
| `SNAx` | Snap-on xStock | SNA | Backed | 18 |
| `SNBIOx` | Sino Biopharmaceutical xStock | 1177 | Backed | 18 |
| `SNDKon` | SanDisk (Ondo Tokenized) | SNDK | Ondo Global Markets | 18 |
| `SNDKx` | Sandisk Corporation xStock | SNDK | Backed | 18 |
| `SNDRx` | Schneider National xStock | SNDR | Backed | 18 |
| `SNDSCx` | Sands China xStock | 1928 | Backed | 18 |
| `SNOWon` | Snowflake (Ondo Tokenized) | SNOW | Ondo Global Markets | 18 |
| `SNOWx` | Snowflake xStock | SNOW | Backed | 18 |
| `SNPSx` | Synopsys xStock | SNPS | Backed | 18 |
| `SNXXx` | SNDK 2x Long ETF xStock | SNXX | Backed | 18 |
| `SNXx` | TD Synnex xStock | SNX | Backed | 18 |
| `SN_GBx` | Smith & Nephew xStock | SNL | Backed | 18 |
| `SOFIon` | SoFi Technologies (Ondo Tokenized) | SOFI | Ondo Global Markets | 18 |
| `SOFIx` | SoFi Technologies xStock | SOFI | Backed | 18 |
| `SOLSx` | Solstice Advanced Materials xStock | SOLS | Backed | 18 |
| `SONYx` | Sony xStock | SONY | Backed | 18 |
| `SONx` | Sonoco Products xStock | SON | Backed | 18 |
| `SOUNon` | SoundHound AI (Ondo Tokenized) | SOUN | Ondo Global Markets | 18 |
| `SOXLon` | Direxion Daily Semi Bull 3X ETF (Ondo Tokenized) | SOXL | Ondo Global Markets | 18 |
| `SOXLx` | Direxion Semiconductor Bull 3X xStock | SOXL | Backed | 18 |
| `SOXQon` | Invesco PHLX Semiconductor ETF (Ondo Tokenized) | SOXQ | Ondo Global Markets | 18 |
| `SOXSon` | Direxion Daily Semi Bear 3X ETF (Ondo Tokenized) | SOXS | Ondo Global Markets | 18 |
| `SOXSx` | 3x Short Semiconductor ETF xStock | SOXS | Backed | 18 |
| `SOXXon` | iShares Semiconductor ETF (Ondo Tokenized) | SOXX | Ondo Global Markets | 18 |
| `SOXXx` | iShares Semiconductor xStock | SOXX | Backed | 18 |
| `SOon` | Southern (Ondo Tokenized) | SO | Ondo Global Markets | 18 |
| `SOx` | Southern xStock | SO | Backed | 18 |
| `SPCEx` | Virgin Galactic xStock | SPCE | Backed | 18 |
| `SPCHx` | Leverage Shares 2X Long SPCX Daily ETF xStock | SPCH | Backed | 18 |
| `SPCXon` | SpaceX (Ondo Tokenized) | SPCX | Ondo Global Markets | 18 |
| `SPCXx` | SpaceX xStock | SPCX | Backed | 18 |
| `SPGIon` | S&P Global (Ondo Tokenized) | SPGI | Ondo Global Markets | 18 |
| `SPGx` | Simon Property xStock | SPG | Backed | 18 |
| `SPOTon` | Spotify (Ondo Tokenized) | SPOT | Ondo Global Markets | 18 |
| `SPX_GBx` | Spirax xStock | SPXL | Backed | 18 |
| `SPYon` | SPDR S&P 500 ETF (Ondo Tokenized) | SPY | Ondo Global Markets | 18 |
| `SPYx` | SP500 xStock | SPY | Backed | 18 |
| `SQQQon` | ProShares UltraPro Short QQQ (Ondo Tokenized) | SQQQ | Ondo Global Markets | 18 |
| `SQQQx` | ProShares UltraPro Short QQQ xStock | SQQQ | Backed | 18 |
| `SREx` | Sempra xStock | SRE | Backed | 18 |
| `SRG_ITx` | Snam xStock | SRGM | Backed | 18 |
| `SSBx` | SouthState Bank xStock | SSB | Backed | 18 |
| `SSDx` | Simpson Manufacturing xStock | SSD | Backed | 18 |
| `SSEx` | SSE xStock | SSEL | Backed | 18 |
| `SSNCx` | SS&C Technologies xStock | SSNC | Backed | 18 |
| `STAGx` | Stag Industrial xStock | STAG | Backed | 18 |
| `STANx` | Standard Chartered xStock | STANL | Backed | 18 |
| `STJ_GBx` | St. James's Place xStock | STJL | Backed | 18 |
| `STLDon` | Steel Dynamics (Ondo Tokenized) | STLD | Ondo Global Markets | 18 |
| `STLDx` | Steel Dynamics xStock | STLD | Backed | 18 |
| `STMMIx` | STMicroelectronics xStock | STMMIM | Backed | 18 |
| `STMon` | STMicroelectronics (Ondo Tokenized) | STM | Ondo Global Markets | 18 |
| `STNGon` | Scorpio Tankers (Ondo Tokenized) | STNG | Ondo Global Markets | 18 |
| `STRCon` | Strategy STRC Preferred (Ondo Tokenized) | STRC | Ondo Global Markets | 18 |
| `STRCx` | Strategy PP Variable xStock | STRC | Backed | 18 |
| `STRKx` | Strategy PP Fixed xStock | STRK | Backed | 18 |
| `STRLx` | Sterling Infrastructure xStock | STRL | Backed | 18 |
| `STTx` | State Street xStock | STT | Backed | 18 |
| `STWDx` | Starwood Property Trust xStock | STWD | Backed | 18 |
| `STXon` | Seagate (Ondo Tokenized) | STX | Ondo Global Markets | 18 |
| `STZx` | Constellation Brands xStock | STZ | Backed | 18 |
| `SUIx` | Sun Communities xStock | SUI | Backed | 18 |
| `SUOPTx` | Sunny Optical Technology Group xStock | 2382 | Backed | 18 |
| `SU_FRx` | Schneider Electric xStock | SUP | Backed | 18 |
| `SVTx` | Severn Trent xStock | SVTL | Backed | 18 |
| `SWKSon` | Skyworks Solutions (Ondo Tokenized) | SWKS | Ondo Global Markets | 18 |
| `SWKx` | Stanley Black & Decker xStock | SWK | Backed | 18 |
| `SWPRPx` | Swire Properties xStock | 1972 | Backed | 18 |
| `SYFx` | Synchrony Financial xStock | SYF | Backed | 18 |
| `SYKx` | Stryker xStock | SYK | Backed | 18 |
| `SYMon` | Symbotic (Ondo Tokenized) | SYM | Ondo Global Markets | 18 |
| `SYSBon` | iShares Systematic Bond ETF (Ondo Tokenized) | SYSB | Ondo Global Markets | 18 |
| `SYYx` | Sysco xStock | SYY | Backed | 18 |
| `SZIGHx` | Shenzhou International xStock | 2313 | Backed | 18 |
| `Sx` | SentinelOne xStock | S | Backed | 18 |
| `TAPx` | Molson Coors Beverage xStock | TAP | Backed | 18 |
| `TASKon` | TaskUs (Ondo Tokenized) | TASK | Ondo Global Markets | 18 |
| `TBLLx` | TBLL xStock | TBLL | Backed | 18 |
| `TCAPx` | TP Icap xStock | TCAPL | Backed | 18 |
| `TCENTx` | Tencent xStock | 700 | Backed | 18 |
| `TCOMon` | Trip.com Group (Ondo Tokenized) | TCOM | Ondo Global Markets | 18 |
| `TDGx` | TransDigm xStock | TDG | Backed | 18 |
| `TDYx` | Teledyne Technologies xStock | TDY | Backed | 18 |
| `TEAMx` | Atlassian xStock | TEAM | Backed | 18 |
| `TEFx` | Telefonica xStock | TEFE | Backed | 18 |
| `TELon` | TE Connectivity (Ondo Tokenized) | TEL | Ondo Global Markets | 18 |
| `TENon` | Tsakos Energy Navigation (Ondo Tokenized) | TEN | Ondo Global Markets | 18 |
| `TERon` | Teradyne (Ondo Tokenized) | TER | Ondo Global Markets | 18 |
| `TERx` | Teradyne, Inc. xStock | TER | Backed | 18 |
| `TEx` | T1 Energy xStock | TE | Backed | 18 |
| `TFCx` | Truist Financial xStock | TFC | Backed | 18 |
| `TFXx` | Teleflex xStock | TFX | Backed | 18 |
| `THCx` | Tenet Healthcare xStock | THC | Backed | 18 |
| `THGx` | The Hanover Insurance xStock | THG | Backed | 18 |
| `TIPon` | iShares TIPS Bond ETF (Ondo Tokenized) | TIP | Ondo Global Markets | 18 |
| `TJXx` | TJX Companies xStock | TJX | Backed | 18 |
| `TKRx` | The Timken xStock | TKR | Backed | 18 |
| `TLNon` | Talen Energy (Ondo Tokenized) | TLN | Ondo Global Markets | 18 |
| `TLNx` | Talen Energy xStock | TLN | Backed | 18 |
| `TLTon` | iShares 20+ Year Treasury Bond ETF (Ondo Tokenized) | TLT | Ondo Global Markets | 18 |
| `TMFx` | Direxion Daily 20 Year Treasury Bull 3X ETF xStock | TMF | Backed | 18 |
| `TMOon` | Thermo Fisher Scientific (Ondo Tokenized) | TMO | Ondo Global Markets | 18 |
| `TMOx` | Thermo Fisher xStock | TMO | Backed | 18 |
| `TMUSon` | T-Mobile US (Ondo Tokenized) | TMUS | Ondo Global Markets | 18 |
| `TMUSx` | T-Mobile xStock | TMUS | Backed | 18 |
| `TMon` | Toyota (Ondo Tokenized) | TM | Ondo Global Markets | 18 |
| `TNGYIx` | Tingyi xStock | 322 | Backed | 18 |
| `TNKon` | Teekay Tankers (Ondo Tokenized) | TNK | Ondo Global Markets | 18 |
| `TOLx` | Toll Brothers xStock | TOL | Backed | 18 |
| `TONXx` | TON xStock | TONX | Backed | 18 |
| `TOSTx` | Toast xStock | TOST | Backed | 18 |
| `TPGx` | TPG xStock | TPG | Backed | 18 |
| `TPLx` | Texas Pacific Land xStock | TPL | Backed | 18 |
| `TPRx` | Tapestry xStock | TPR | Backed | 18 |
| `TQQQon` | ProShares UltraPro QQQ (Ondo Tokenized) | TQQQ | Ondo Global Markets | 18 |
| `TQQQx` | TQQQ xStock | TQQQ | Backed | 18 |
| `TRGPx` | Targa Resources xStock | TRGP | Backed | 18 |
| `TRMBx` | Trimble xStock | TRMB | Backed | 18 |
| `TRN_ITx` | Terna xStock | TRNM | Backed | 18 |
| `TRONx` | Tron xStock | TRON | Backed | 18 |
| `TROWx` | T. Rowe Price xStock | TROW | Backed | 18 |
| `TRUx` | TransUnion xStock | TRU | Backed | 18 |
| `TRVx` | The Travelers Companies xStock | TRV | Backed | 18 |
| `TSCO_GBx` | Tesco xStock | TSCOL | Backed | 18 |
| `TSCOx` | Tractor Supply xStock | TSCO | Backed | 18 |
| `TSEMon` | Tower Semiconductor (Ondo Tokenized) | TSEM | Ondo Global Markets | 18 |
| `TSEMx` | Tower Semiconductor xStock | TSEM | Backed | 18 |
| `TSLAon` | Tesla (Ondo Tokenized) | TSLA | Ondo Global Markets | 18 |
| `TSLAx` | Tesla xStock | TSLA | Backed | 18 |
| `TSLLx` | Direxion Daily TSLA Bull 2X Shares xStock | TSLL | Backed | 18 |
| `TSMon` | Taiwan Semiconductor Manufacturing (Ondo Tokenized) | TSM | Ondo Global Markets | 18 |
| `TSMx` | TSMC xStock | TSM | Backed | 18 |
| `TSNx` | Tyson Foods xStock | TSN | Backed | 18 |
| `TTCx` | The Toro xStock | TTC | Backed | 18 |
| `TTDx` | The Trade Desk xStock | TTD | Backed | 18 |
| `TTEKx` | Tetra Tech xStock | TTEK | Backed | 18 |
| `TTEx` | TotalEnergies xStock | TTEP | Backed | 18 |
| `TTMIon` | TTM Technologies (Ondo Tokenized) | TTMI | Ondo Global Markets | 18 |
| `TTMIx` | TTM Technologies xStock | TTMI | Backed | 18 |
| `TTWOx` | Take-Two Interactive Software xStock | TTWO | Backed | 18 |
| `TTon` | Trane Technologies (Ondo Tokenized) | TT | Ondo Global Markets | 18 |
| `TWLOx` | Twilio xStock | TWLO | Backed | 18 |
| `TWSTx` | Twist Bioscience xStock | TWST | Backed | 18 |
| `TW_GBx` | Taylor Wimpey xStock | TWL | Backed | 18 |
| `TWx` | Tradeweb Markets xStock | TW | Backed | 18 |
| `TXNon` | Texas Instruments (Ondo Tokenized) | TXN | Ondo Global Markets | 18 |
| `TXNx` | Texas Instruments xStock | TXN | Backed | 18 |
| `TXRHx` | Texas Roadhouse xStock | TXRH | Backed | 18 |
| `TXTx` | Textron xStock | TXT | Backed | 18 |
| `TYLx` | Tyler Technologies xStock | TYL | Backed | 18 |
| `Ton` | AT&T (Ondo Tokenized) | T | Ondo Global Markets | 18 |
| `UALx` | United Airlines xStock | UAL | Backed | 18 |
| `UAMYon` | United States Antimony (Ondo Tokenized) | UAMY | Ondo Global Markets | 18 |
| `UBERon` | Uber (Ondo Tokenized) | UBER | Ondo Global Markets | 18 |
| `UBERx` | Uber xStock | UBER | Backed | 18 |
| `UCB_BEx` | UCB xStock | UCBB | Backed | 18 |
| `UCGx` | UniCredit xStock | UCGM | Backed | 18 |
| `UCTTon` | Ultra Clean Holdings (Ondo Tokenized) | UCTT | Ondo Global Markets | 18 |
| `UDRx` | UDR xStock | UDR | Backed | 18 |
| `UECon` | Uranium Energy (Ondo Tokenized) | UEC | Ondo Global Markets | 18 |
| `UGIx` | UGI xStock | UGI | Backed | 18 |
| `UHALx` | U-Haul xStock | UHAL | Backed | 18 |
| `UHSx` | Universal Health Services xStock | UHS | Backed | 18 |
| `UIx` | Ubiquiti xStock | UI | Backed | 18 |
| `ULSx` | UL Solutions xStock | ULS | Backed | 18 |
| `ULTAx` | Ulta Beauty xStock | ULTA | Backed | 18 |
| `ULVRx` | Unilever xStock | ULVRL | Backed | 18 |
| `UMCon` | United Microelectronics (Ondo Tokenized) | UMC | Ondo Global Markets | 18 |
| `UMGx` | Universal Music xStock | UMGA | Backed | 18 |
| `UNGon` | US Natural Gas Fund (Ondo Tokenized) | UNG | Ondo Global Markets | 18 |
| `UNHon` | UnitedHealth (Ondo Tokenized) | UNH | Ondo Global Markets | 18 |
| `UNHx` | UnitedHealth xStock | UNH | Backed | 18 |
| `UNMx` | Unum xStock | UNM | Backed | 18 |
| `UNPon` | Union Pacific Corporation (Ondo Tokenized) | UNP | Ondo Global Markets | 18 |
| `UNPx` | Union Pacific xStock | UNP | Backed | 18 |
| `UPSx` | United Parcel Service xStock | UPS | Backed | 18 |
| `URAon` | Global X Uranium ETF (Ondo Tokenized) | URA | Ondo Global Markets | 18 |
| `URAx` | Global X Uranium ETF xStock | URA | Backed | 18 |
| `URIx` | United Rentals xStock | URI | Backed | 18 |
| `URNMon` | Sprott Uranium Miners ETF (Ondo Tokenized) | URNM | Ondo Global Markets | 18 |
| `URNMx` | Sprott Uranium Miners ETF xStock | URNM | Backed | 18 |
| `USARon` | USA Rare Earth (Ondo Tokenized) | USAR | Ondo Global Markets | 18 |
| `USARx` | USA Rare Earth Inc. xStock | USAR | Backed | 18 |
| `USBx` | U.S. Bancorp xStock | USB | Backed | 18 |
| `USFDx` | US Foods xStock | USFD | Backed | 18 |
| `USFRon` | WisdomTree Floating Rate Treasury Fund (Ondo Tokenized) | USFR | Ondo Global Markets | 18 |
| `USHYon` | iShares Broad USD High Yield Corporate Bond ETF (Ondo Tokenized) | USHY | Ondo Global Markets | 18 |
| `USOon` | United States Oil Fund (Ondo Tokenized) | USO | Ondo Global Markets | 18 |
| `USOx` | United States Oil Fund xStock | USO | Backed | 18 |
| `USPXx` | Franklin U.S. Equity Index xStock | USPX | Backed | 18 |
| `UTHRx` | United Therapeutics xStock | UTHR | Backed | 18 |
| `UUUUon` | Energy Fuels (Ondo Tokenized) | UUUU | Ondo Global Markets | 18 |
| `UUUUx` | Energy Fuels Inc. xStock | UUUU | Backed | 18 |
| `UU_GBx` | United Utilities xStock | UUL | Backed | 18 |
| `UVXYx` | ProShares Ultra VIX Short-Term Futures ETF xStock | UVXY | Backed | 18 |
| `Ux` | Unity Software xStock | U | Backed | 18 |
| `VCXon` | Fundrise Innovation Fund (Ondo Tokenized) | VCX | Ondo Global Markets | 18 |
| `VCXx` | Fundrise Innovation Fund, LLC xStock | VCX | Backed | 18 |
| `VDEon` | Vanguard Energy ETF (Ondo Tokenized) | VDE | Ondo Global Markets | 18 |
| `VEEVx` | Veeva Systems xStock | VEEV | Backed | 18 |
| `VFCx` | VF xStock | VFC | Backed | 18 |
| `VFSon` | VinFast Auto (Ondo Tokenized) | VFS | Ondo Global Markets | 18 |
| `VGKx` | Vanguard FTSE Europe ETF xStock | VGK | Backed | 18 |
| `VIAVx` | Viavi Solutions xStock | VIAV | Backed | 18 |
| `VICIx` | VICI Properties xStock | VICI | Backed | 18 |
| `VICRon` | Vicor (Ondo Tokenized) | VICR | Ondo Global Markets | 18 |
| `VICRx` | Vicor xStock | VICR | Backed | 18 |
| `VIDAx` | Vida Global xStock | VIDA | Backed | 18 |
| `VIEx` | Veolia Environnement xStock | VIEP | Backed | 18 |
| `VIKx` | Viking xStock | VIK | Backed | 18 |
| `VIRTx` | Virtu Financial xStock | VIRT | Backed | 18 |
| `VLOx` | Valero Energy xStock | VLO | Backed | 18 |
| `VLTOx` | Veralto xStock | VLTO | Backed | 18 |
| `VMCx` | Vulcan Materials xStock | VMC | Backed | 18 |
| `VMIx` | Valmont Industries xStock | VMI | Backed | 18 |
| `VNAx` | Vonovia xStock | VNAD | Backed | 18 |
| `VNOMx` | Viper Energy xStock | VNOM | Backed | 18 |
| `VNOx` | Vornado Realty Trust xStock | VNO | Backed | 18 |
| `VNQon` | Vanguard Real Estate ETF (Ondo Tokenized) | VNQ | Ondo Global Markets | 18 |
| `VODx` | Vodafone xStock | VODL | Backed | 18 |
| `VOOx` | Vanguard S&P 500 xStock | VOO | Backed | 18 |
| `VOW3x` | Volkswagen xStock | VOW3D | Backed | 18 |
| `VOYAx` | Voya Financial xStock | VOYA | Backed | 18 |
| `VPGon` | Vishay Precision Group (Ondo Tokenized) | VPG | Ondo Global Markets | 18 |
| `VRSKx` | Verisk Analytics xStock | VRSK | Backed | 18 |
| `VRSNon` | VeriSign (Ondo Tokenized) | VRSN | Ondo Global Markets | 18 |
| `VRSNx` | VeriSign xStock | VRSN | Backed | 18 |
| `VRTXon` | Vertex Pharmaceuticals (Ondo Tokenized) | VRTX | Ondo Global Markets | 18 |
| `VRTXx` | Vertex Pharmaceuticals xStock | VRTX | Backed | 18 |
| `VRTon` | Vertiv (Ondo Tokenized) | VRT | Ondo Global Markets | 18 |
| `VRTx` | Vertiv Holdings Co xStock | VRT | Backed | 18 |
| `VSHon` | Vishay Intertechnology (Ondo Tokenized) | VSH | Ondo Global Markets | 18 |
| `VSNTx` | Versant Media xStock | VSNT | Backed | 18 |
| `VSTon` | Vistra (Ondo Tokenized) | VST | Ondo Global Markets | 18 |
| `VTIon` | Vanguard Total Stock Market ETF (Ondo Tokenized) | VTI | Ondo Global Markets | 18 |
| `VTIx` | Vanguard xStock | VTI | Backed | 18 |
| `VTRSx` | Viatris xStock | VTRS | Backed | 18 |
| `VTRx` | Ventas xStock | VTR | Backed | 18 |
| `VTVon` | Vanguard Value ETF (Ondo Tokenized) | VTV | Ondo Global Markets | 18 |
| `VTx` | Vanguard Total World xStock | VT | Backed | 18 |
| `VUGx` | Vanguard Growth ETF xStock | VUG | Backed | 18 |
| `VXUSx` | Vanguard Total International Stock ETF xStock | VXUS | Backed | 18 |
| `VZon` | Verizon (Ondo Tokenized) | VZ | Ondo Global Markets | 18 |
| `VZx` | Verizon Communications xStock | VZ | Backed | 18 |
| `Von` | Visa (Ondo Tokenized) | V | Ondo Global Markets | 18 |
| `Vx` | Visa xStock | V | Backed | 18 |
| `WABx` | Westinghouse Air Brake Technologies xStock | WAB | Backed | 18 |
| `WALx` | Western Alliance Bancorp xStock | WAL | Backed | 18 |
| `WATx` | Waters xStock | WAT | Backed | 18 |
| `WBDx` | Warner Bros. Discovery xStock | WBD | Backed | 18 |
| `WCCon` | WESCO International (Ondo Tokenized) | WCC | Ondo Global Markets | 18 |
| `WCCx` | WESCO International xStock | WCC | Backed | 18 |
| `WDAYx` | Workday xStock | WDAY | Backed | 18 |
| `WDCon` | Western Digital (Ondo Tokenized) | WDC | Ondo Global Markets | 18 |
| `WDCx` | Western Digital xStock | WDC | Backed | 18 |
| `WECx` | WEC Energy xStock | WEC | Backed | 18 |
| `WEIRx` | Weir xStock | WEIRL | Backed | 18 |
| `WELLx` | Welltower xStock | WELL | Backed | 18 |
| `WENon` | Wendy's (Ondo Tokenized) | WEN | Ondo Global Markets | 18 |
| `WENx` | Wendy's xStock | WEN | Backed | 18 |
| `WEXx` | WEX xStock | WEX | Backed | 18 |
| `WFCon` | Wells Fargo (Ondo Tokenized) | WFC | Ondo Global Markets | 18 |
| `WFCx` | Wells Fargo xStock | WFC | Backed | 18 |
| `WGSx` | GeneDx xStock | WGS | Backed | 18 |
| `WHGROx` | WH xStock | 288 | Backed | 18 |
| `WHRFRx` | Wharf Real Estate Investment xStock | 1997 | Backed | 18 |
| `WHx` | Wyndham Hotels & Resorts xStock | WH | Backed | 18 |
| `WLKon` | Westlake (Ondo Tokenized) | WLK | Ondo Global Markets | 18 |
| `WLKx` | Westlake xStock | WLK | Backed | 18 |
| `WMBon` | Williams (Ondo Tokenized) | WMB | Ondo Global Markets | 18 |
| `WMBx` | Williams Companies xStock | WMB | Backed | 18 |
| `WMSx` | Advanced Drainage Systems xStock | WMS | Backed | 18 |
| `WMTon` | Walmart (Ondo Tokenized) | WMT | Ondo Global Markets | 18 |
| `WMTx` | Walmart xStock | WMT | Backed | 18 |
| `WMon` | Waste Management (Ondo Tokenized) | WM | Ondo Global Markets | 18 |
| `WMx` | Waste Management xStock | WM | Backed | 18 |
| `WOLFon` | Wolfspeed (Ondo Tokenized) | WOLF | Ondo Global Markets | 18 |
| `WPCx` | W.P. Carey xStock | WPC | Backed | 18 |
| `WPPx` | WPP xStock | WPPL | Backed | 18 |
| `WRBx` | W.R. Berkley xStock | WRB | Backed | 18 |
| `WRFHDx` | The Wharf Holdings xStock | 4 | Backed | 18 |
| `WRLDx` | World Acceptance xStock | WRLD | Backed | 18 |
| `WSMx` | Williams-Sonoma xStock | WSM | Backed | 18 |
| `WSOx` | Watsco xStock | WSO | Backed | 18 |
| `WSTx` | West Pharmaceutical Services xStock | WST | Backed | 18 |
| `WSon` | Worthington Steel (Ondo Tokenized) | WS | Ondo Global Markets | 18 |
| `WTBx` | Whitbread xStock | WTBL | Backed | 18 |
| `WTFCx` | Wintrust Financial xStock | WTFC | Backed | 18 |
| `WTRGx` | Essential Utilities xStock | WTRG | Backed | 18 |
| `WTSx` | Watts Water Technologies xStock | WTS | Backed | 18 |
| `WULFon` | Terawulf (Ondo Tokenized) | WULF | Ondo Global Markets | 18 |
| `WULFx` | TeraWulf xStock | WULF | Backed | 18 |
| `WUXIBx` | WuXi Biologics xStock | 2269 | Backed | 18 |
| `WWDx` | Woodward xStock | WWD | Backed | 18 |
| `WXXDCx` | WuXi XDC Cayman xStock | 2268 | Backed | 18 |
| `WYFIon` | WhiteFiber (Ondo Tokenized) | WYFI | Ondo Global Markets | 18 |
| `WYFIx` | Whitefiber xStock | WYFI | Backed | 18 |
| `WYNNx` | Wynn Resorts xStock | WYNN | Backed | 18 |
| `WYx` | Weyerhaeuser xStock | WY | Backed | 18 |
| `Wx` | Wayfair xStock | W | Backed | 18 |
| `XBIx` | State Street SPDR S&P Biotech ETF xStock | XBI | Backed | 18 |
| `XELx` | Xcel Energy xStock | XEL | Backed | 18 |
| `XEx` | X-Energy xStock | XE | Backed | 18 |
| `XIAOx` | Xiaomi xStock | 1810 | Backed | 18 |
| `XLEx` | Energy Select Sector SPDR Fund xStock | XLE | Backed | 18 |
| `XOMon` | Exxon Mobil (Ondo Tokenized) | XOM | Ondo Global Markets | 18 |
| `XOMx` | Exxon Mobil xStock | XOM | Backed | 18 |
| `XOPx` | SPDR S&P Oil & Gas Exploration & Production ETF xStock | XOP | Backed | 18 |
| `XPOx` | XPO xStock | XPO | Backed | 18 |
| `XPx` | XP xStock | XP | Backed | 18 |
| `XRXx` | Xerox xStock | XRX | Backed | 18 |
| `XYLDon` | Global X S&P 500 Covered Call ETF (Ondo Tokenized) | XYLD | Ondo Global Markets | 18 |
| `XYLx` | Xylem xStock | XYL | Backed | 18 |
| `XYZon` | Block (Ondo Tokenized) | XYZ | Ondo Global Markets | 18 |
| `XYZx` | Block xStock | XYZ | Backed | 18 |
| `YEARon` | AB Ultra Short Income ETF (Ondo Tokenized) | YEAR | Ondo Global Markets | 18 |
| `YLDEx` | Franklin ClearBridge Enhanced Income xStock | YLDE | Backed | 18 |
| `YUMx` | Yum Brands xStock | YUM | Backed | 18 |
| `ZBHx` | Zimmer Biomet xStock | ZBH | Backed | 18 |
| `ZBRAx` | Zebra Technologies xStock | ZBRA | Backed | 18 |
| `ZHAOMx` | Zhaojin Mining Industry xStock | 1818 | Backed | 18 |
| `ZJGLDx` | Zijin Gold International xStock | 2259 | Backed | 18 |
| `ZMx` | Zoom Communications xStock | ZM | Backed | 18 |
| `ZSx` | Zscaler xStock | ZS | Backed | 18 |
| `ZTSx` | Zoetis xStock | ZTS | Backed | 18 |
| `Zx` | Zillow xStock | Z | Backed | 18 |
| `bCOIN` | Backed Coinbase Global | COIN | Backed | 18 |
| `bCSPX` | Backed CSPX Core S&P 500 | CSPX.L | Backed | 18 |
| `bGME` | Backed GameStop Corp | GME | Backed | 18 |
| `bGOOGL` | Backed Alphabet Inc | GOOGL | Backed | 18 |
| `bMSFT` | Backed Microsoft Corp | MSFT | Backed | 18 |
| `bMSTR` | Backed MicroStrategy Inc | MSTR | Backed | 18 |
| `bNIU` | Backed Niu Technologies | NIU | Backed | 18 |
| `bNVDA` | Backed NVIDIA Corp | NVDA | Backed | 18 |
| `bTSLA` | Backed Tesla Inc | TSLA | Backed | 18 |

## Base (`base`, [addresses](../../sauce-chains/references/base-stocks.md))

| Symbol | Token | Ticker | Issuer | Decimals |
| --- | --- | --- | --- | --- |
| `AAPLc` | Apple Inc. | AAPL | Coinbase | 8 |
| `AEOc` | American Eagle Outfitters, Inc. | AEO | Coinbase | 8 |
| `AMCc` | AMC Entertainment Holdings, Inc. | AMC | Coinbase | 8 |
| `AMDc` | Advanced Micro Devices, Inc. | AMD | Coinbase | 8 |
| `AMZNc` | Amazon.com Inc. | AMZN | Coinbase | 8 |
| `ASTSc` | AST SpaceMobile, Inc. | ASTS | Coinbase | 8 |
| `AVGOc` | Broadcom Inc. | AVGO | Coinbase | 8 |
| `BEc` | Bloom Energy Corporation | BE | Coinbase | 8 |
| `BIRDc` | Smartbird, Inc. | BIRD | Coinbase | 8 |
| `BMNRc` | BitMine Immersion Technologies, Inc. | BMNR | Coinbase | 8 |
| `BYNDc` | Beyond Meat, Inc. | BYND | Coinbase | 8 |
| `CAKEc` | Cheesecake Factory Inc | CAKE | Coinbase | 8 |
| `CIFRc` | Cipher Digital Inc. | CIFR | Coinbase | 8 |
| `CLSKc` | CleanSpark, Inc. | CLSK | Coinbase | 8 |
| `CRCLc` | Circle Internet Group Inc. | CRCL | Coinbase | 8 |
| `CRWVc` | CoreWeave, Inc. | CRWV | Coinbase | 8 |
| `DJTc` | Trump Media & Technology Group Corp. | DJT | Coinbase | 8 |
| `DUOLc` | Duolingo, Inc. | DUOL | Coinbase | 8 |
| `GMEc` | GameStop Corp. | GME | Coinbase | 8 |
| `GOOGLc` | Alphabet Inc. | GOOGL | Coinbase | 8 |
| `HIMSc` | Hims & Hers Health, Inc. | HIMS | Coinbase | 8 |
| `HTZc` | Hertz Global Holdings, Inc. | HTZ | Coinbase | 8 |
| `HUTc` | Hut 8 Corp. | HUT | Coinbase | 8 |
| `KSSc` | Kohl's Corporation | KSS | Coinbase | 8 |
| `LCIDc` | Lucid Group, Inc. | LCID | Coinbase | 8 |
| `LLYc` | Eli Lilly & Co | LLY | Coinbase | 8 |
| `MARAc` | MARA Holdings, Inc. | MARA | Coinbase | 8 |
| `METAc` | Meta Platforms Inc. | META | Coinbase | 8 |
| `MRNAc` | Moderna, Inc. | MRNA | Coinbase | 8 |
| `MRVLc` | Marvell Technology, Inc. | MRVL | Coinbase | 8 |
| `MSFTc` | Microsoft Corporation | MSFT | Coinbase | 8 |
| `MSTRc` | Strategy Inc. | MSTR | Coinbase | 8 |
| `MUc` | Micron Technology Inc. | MU | Coinbase | 8 |
| `NFLXc` | Netflix Inc | NFLX | Coinbase | 8 |
| `NVAXc` | Novavax Inc | NVAX | Coinbase | 8 |
| `NVDAc` | NVIDIA Corporation | NVDA | Coinbase | 8 |
| `OPENc` | Opendoor Technologies Inc. | OPEN | Coinbase | 8 |
| `ORCLc` | Oracle Corporation | ORCL | Coinbase | 8 |
| `PFEc` | Pfizer Inc | PFE | Coinbase | 8 |
| `PLTRc` | Palantir Technologies Inc. | PLTR | Coinbase | 8 |
| `PMc` | Philip Morris International Inc. | PM | Coinbase | 8 |
| `PTONc` | Peloton Interactive, Inc. | PTON | Coinbase | 8 |
| `PYPLc` | PayPal Holdings, Inc. | PYPL | Coinbase | 8 |
| `QUBTc` | Quantum Computing Inc. | QUBT | Coinbase | 8 |
| `RBLXc` | Roblox Corporation | RBLX | Coinbase | 8 |
| `RDDTc` | Reddit, Inc. | RDDT | Coinbase | 8 |
| `RIOTc` | Riot Platforms, Inc. | RIOT | Coinbase | 8 |
| `SNDKc` | Sandisk Corporation | SNDK | Coinbase | 8 |
| `SOUNc` | SoundHound AI, Inc. | SOUN | Coinbase | 8 |
| `SPCXc` | Space Exploration Technologies Corp. | SPCX | Coinbase | 8 |
| `TSLAc` | Tesla Inc. | TSLA | Coinbase | 8 |
| `TTWOc` | Take-Two Interactive Software, Inc. | TTWO | Coinbase | 8 |
| `USDEc` | StablecoinX Inc. | USDE | Coinbase | 8 |
| `VVVc` | Valvoline Inc | VVV | Coinbase | 8 |
| `WENc` | Wendy's Co | WEN | Coinbase | 8 |
| `WULFc` | TeraWulf Inc. | WULF | Coinbase | 8 |
| `WWc` | WW International, Inc. | WW | Coinbase | 8 |
| `XYZc` | Block, Inc. | XYZ | Coinbase | 8 |
| `bCOIN` | Backed Coinbase Global | COIN | Backed | 18 |
| `bCSPX` | Backed CSPX Core S&P 500 | CSPX.L | Backed | 18 |
| `bGME` | Backed GameStop Corp | GME | Backed | 18 |
| `bGOOGL` | Backed Alphabet Inc | GOOGL | Backed | 18 |
| `bMSFT` | Backed Microsoft Corp | MSFT | Backed | 18 |
| `bMSTR` | Backed MicroStrategy Inc | MSTR | Backed | 18 |
| `bNIU` | Backed Niu Technologies | NIU | Backed | 18 |
| `bNVDA` | Backed NVIDIA Corp | NVDA | Backed | 18 |
| `bTSLA` | Backed Tesla Inc | TSLA | Backed | 18 |
