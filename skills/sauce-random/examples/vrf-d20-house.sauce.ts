// VRFD20's house(player), in Sauce: the house a player's roll of `vrf-d20.sauce.ts` landed on. A read:
// simulate it, and its return is the house's name.
//
// Ported from: smartcontractkit/documentation, public/samples/VRF/v2-5/VRFD20.sol (house,
// _getHouseName)
//
//   sauce simulate vrf-d20-house.sauce.ts --chain <chain> --args <player>
//
//   player: Address  whose roll to read
//
// On Base:
//
//   sauce simulate vrf-d20-house.sauce.ts --chain base --args <player>
const ROLL_IN_PROGRESS = 42;

function main(player: Address): string {
  const houseNames = [
    "Targaryen",
    "Lannister",
    "Stark",
    "Tyrell",
    "Baratheon",
    "Martell",
    "Tully",
    "Bolton",
    "Greyjoy",
    "Arryn",
    "Frey",
    "Mormont",
    "Tarley",
    "Dayne",
    "Umber",
    "Valeryon",
    "Manderly",
    "Clegane",
    "Glover",
    "Karstark",
  ];
  const results = crypto.keccak256("VRFD20.results");
  const result = evm.sload(crypto.keccak256(abi.encode(player, results)));
  require(result != 0, "Dice not rolled");
  require(result != ROLL_IN_PROGRESS, "Roll in progress");
  return houseNames[result - 1];
}
