import * as turf from "@turf/turf";

// Define multiple campuses with names
const campuses = [
  {
    name: "HeadCampus",
    polygon: turf.polygon([
      [
        [78.66361657971697, 28.822244722324484],
        [78.6661459526332, 28.825112490408713],
        [78.65713321095365, 28.82818569617592],
        [78.65321167331075, 28.82405891358536],
        [78.65600892925295, 28.821880139878317],
        [78.66361657971697, 28.822244722324484],
      ],
    ]),
  },
];


export function checkEntryExit({ previousPoint, currentPoint }) {
  if (!previousPoint || !currentPoint) {
    console.warn("⚠️ Incomplete data for checkEntryExit.");
    return null;
  }

  const previousGeo = turf.point([
    previousPoint.longitude,
    previousPoint.latitude,
  ]);
  const currentGeo = turf.point([
    currentPoint.longitude,
    currentPoint.latitude,
  ]);

  for (const campus of campuses) {
    const wasInside = turf.booleanPointInPolygon(previousGeo, campus.polygon);
    const isInside = turf.booleanPointInPolygon(currentGeo, campus.polygon);

    if (!wasInside && isInside) {
      return { campus: campus.name, eventType: "Entered" };
    } else if (wasInside && !isInside) {
      return { campus: campus.name, eventType: "Exited" };
    }
  }

  // No entry/exit change for any campus
  return null;
}
