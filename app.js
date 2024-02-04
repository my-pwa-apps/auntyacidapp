
//auntyacidapp.pages.dev

if("serviceWorker" in navigator) {
	navigator.serviceWorker.register("./serviceworker.js");
}

async function Share() 
{
	if(navigator.share) {
		comicurl = "https://corsproxy.garfieldapp.workers.dev/cors-proxy?"+pictureUrl+".png";
		const response = await fetch(comicurl);
		const blob = await response.blob();
		const file = new File([blob], "garfield.png", {type: "image/png",
        lastModified: new Date().getTime()});
		navigator.share({
			url: 'https://auntyacidapp.pages.dev',
			text: 'Shared from https://auntyacidapp.pages.dev',
			files: [file]
		});
	}
}

 function Addfav()
{
	formattedComicDate = year + "/" + month + "/" + day;
	var favs = JSON.parse(localStorage.getItem('favs'));
	if(favs == null)
	{
		favs = [];
	}
	if(favs.indexOf(formattedComicDate) == -1)
	{
		favs.push(formattedComicDate);
		$(".favicon").css({"color": "red"}).removeClass('fa-heart-o').addClass('fa-heart');
		document.getElementById("showfavs").disabled = false;
	}
	else
	{
		favs.splice(favs.indexOf(formattedComicDate), 1);
		$(".favicon").css({"color": "red"}).removeClass('fa-heart').addClass('fa-heart-o');
		if(favs.length === 0)
		{
			document.getElementById("showfavs").checked = false;
			document.getElementById("showfavs").disabled = true;
			document.getElementById("Current").innerHTML = 'Today';
		}
	}
	favs.sort();
	localStorage.setItem('favs', JSON.stringify(favs));
	CompareDates();
	showComic();
}

function onLoad()
{
previousclicked = false;
previousUrl = "";
var favs = JSON.parse(localStorage.getItem('favs'));
if(favs == null)
{
	favs = [];
}
if(document.getElementById("showfavs").checked) {
	currentselectedDate = new Date(favs[0]);
	if(favs.length === 0)
	{
		document.getElementById("showfavs").checked = false;
		document.getElementById("showfavs").disabled = true;
		currentselectedDate = document.getElementById("DatePicker").valueAsDate = new Date();
		
	}
}
else
{
	if(favs.length === 0)
	{
		document.getElementById("showfavs").checked = false;
		document.getElementById("showfavs").disabled = true;
		currentselectedDate = document.getElementById("DatePicker").valueAsDate = new Date();
	}
	currentselectedDate = document.getElementById("DatePicker").valueAsDate = new Date();
	document.getElementById("Next").disabled = true;
	document.getElementById("Current").disabled = true;
}
	
formatDate(new Date());
today = year + '-' + month + '-' + day;
document.getElementById("DatePicker").setAttribute("max", today);

if(document.getElementById("lastdate").checked)   
{
	if(localStorage.getItem('lastcomic') !== null)
	{
		currentselectedDate = new Date(localStorage.getItem('lastcomic'));
	}
		
}

CompareDates();
showComic();
}

function PreviousClick() {
	if(document.getElementById("showfavs").checked) {
		var favs = JSON.parse(localStorage.getItem('favs'));
		if(favs.indexOf(formattedComicDate) > 0){
			currentselectedDate = new Date(favs[favs.indexOf(formattedComicDate) - 1]);}}
	else{
		currentselectedDate.setDate(currentselectedDate.getDate() - 1);
	}
	previousclicked = true;
	CompareDates();
	showComic();

}

function NextClick() {
	if(document.getElementById("showfavs").checked) {
		var favs = JSON.parse(localStorage.getItem('favs'));
		if(favs.indexOf(formattedComicDate) < favs.length - 1){
			currentselectedDate = new Date(favs[favs.indexOf(formattedComicDate) + 1]);}}
	else{
		currentselectedDate.setDate(currentselectedDate.getDate() + 1);
	}
	CompareDates();
	showComic();

}

function FirstClick() {
	if(document.getElementById("showfavs").checked) {
		var favs = JSON.parse(localStorage.getItem('favs'));
		currentselectedDate = new Date(JSON.parse(localStorage.getItem('favs'))[0]);}
	else{
	currentselectedDate = new Date(Date.UTC(2013, 4, 6,12));
	}
	CompareDates();
	showComic();

}

function CurrentClick() {
	if(document.getElementById("showfavs").checked)
	 {
		var favs = JSON.parse(localStorage.getItem('favs'));
		favslength = favs.length - 1;
		currentselectedDate = new Date(JSON.parse(localStorage.getItem('favs'))[favslength]);
	 }
	else
	{
	currentselectedDate = new Date();
	}
	CompareDates();
	showComic();

}


function RandomClick()
{
	if(document.getElementById("showfavs").checked) {
		currentselectedDate = new Date(JSON.parse(localStorage.getItem('favs'))[Math.floor(Math.random() * JSON.parse(localStorage.getItem('favs')).length)]);}
	else{
		start = new Date("2013-05-06");
		end = new Date();
		currentselectedDate = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
	}
	
	CompareDates();
	showComic();

}

function DateChange() {
	currentselectedDate = document.getElementById('DatePicker');
	currentselectedDate = new Date(currentselectedDate.value);
	CompareDates();
	showComic();
}

function showComic()
{
	formatDate(currentselectedDate);
	formattedDate = year + "-" + month + "-" + day;
	formattedComicDate = year + "/" + month + "/" + day;
	document.getElementById('DatePicker').value = formattedDate;
	siteUrl =  "https://corsproxy.garfieldapp.workers.dev/cors-proxy?https://www.gocomics.com/aunty-acid/" + formattedComicDate;
    //siteUrl =  "https://corsproxy.io/?https://www.gocomics.com/garfield/" + formattedComicDate;
	//siteUrl = "https://corsproxy.io/?https://dirkjan.nl/cartoon/"+"20231130";
	localStorage.setItem('lastcomic', currentselectedDate);
	fetch(siteUrl)
    .then(function(response)
	{
      return response.text();
    })
    .then(function(text)
	{
      siteBody = text;
      picturePosition = siteBody.indexOf("https://assets.amuniversal.com");
      pictureUrl = siteBody.substring(picturePosition, picturePosition + 63);
      if(pictureUrl != previousUrl) {
		document.getElementById("comic").src = pictureUrl;
	  }
	  else
	  {
		if(previousclicked == true)
		{
			PreviousClick();
		}
		
		
	  }	
	 
	  previousclicked = false;			
	  previousUrl = pictureUrl;
	  var favs = JSON.parse(localStorage.getItem('favs'));
		if(favs == null)
		{
			favs = [];
		}
		if(favs.indexOf(formattedComicDate) == -1)
		{
			$(".favicon").css({"color": "red"}).removeClass('fa-heart').addClass('fa-heart-o');

		}	
		else
		{
			$(".favicon").css({"color": "red"}).removeClass('fa-heart-o').addClass('fa-heart');
		}
    });
};


function CompareDates() {
	var favs = JSON.parse(localStorage.getItem('favs'));
	if(document.getElementById("showfavs").checked)
	{
		document.getElementById("DatePicker").disabled = true;
		startDate = new Date(favs[0])}
	else{	
		document.getElementById("DatePicker").disabled = false;
		startDate = new Date("2013/05/06");
	}
	startDate = startDate.setHours(0, 0, 0, 0);
	currentselectedDate = currentselectedDate.setHours(0, 0, 0, 0);
	startDate = new Date(startDate);
	currentselectedDate = new Date(currentselectedDate);
	if(currentselectedDate.getTime() <= startDate.getTime()) {
		document.getElementById("Previous").disabled = true;
		document.getElementById("First").disabled = true;
		formatDate(startDate);
		startDate = year + '-' + month + '-' + day;
		currentselectedDate = new Date(Date.UTC(year, month-1, day,12));
	} else {
		document.getElementById("Previous").disabled = false;
		document.getElementById("First").disabled = false;
	}
	if(document.getElementById("showfavs").checked) {
		endDate = new Date(favs[favs.length - 1]);
	}
	else{ 
		endDate = new Date();
	}
	endDate = endDate.setHours(0, 0, 0, 0);
	endDate = new Date(endDate);
	if(currentselectedDate.getTime() >= endDate.getTime()) {
		document.getElementById("Next").disabled = true;
		document.getElementById("Current").disabled = true;
		formatDate(endDate);
		endDate = year + '-' + month + '-' + day;
		currentselectedDate = new Date(Date.UTC(year, month-1, day,12));
	} else {
		document.getElementById("Next").disabled = false;
		document.getElementById("Current").disabled = false;
	}
	if(document.getElementById("showfavs").checked) {
		//document.getElementById("Current").disabled = true;
		if(favs.length == 1) {
			document.getElementById("Random").disabled = true;
			document.getElementById("Previous").disabled = true;
			document.getElementById("First").disabled = true;
		
		}}
	else {
		document.getElementById("Random").disabled = false;}
}

function formatDate(datetoFormat) {
	day = datetoFormat.getDate();
	month = datetoFormat.getMonth() + 1;
	year = datetoFormat.getFullYear();
	month = ("0" + month).slice(-2);
	day = ("0" + day).slice(-2);
}

function Rotate() {
	var element = document.getElementById('comic');
	if(element.className === "normal") {
		element.className = "rotate";
	} else if(element.className === "rotate") {
		element.className = 'normal';
	}
}

document.addEventListener('swiped-down', function(e) {
	if(document.getElementById("swipe").checked) {
		RandomClick()}
})

document.addEventListener('swiped-right', function(e) {
	if(document.getElementById("swipe").checked) {
		PreviousClick()}
})


document.addEventListener('swiped-left', function(e) {
	if(document.getElementById("swipe").checked) {
		NextClick()}
})

document.addEventListener('swiped-up', function(e) {
	if(document.getElementById("swipe").checked) {
		CurrentClick()}
})

setStatus = document.getElementById('swipe');
setStatus.onclick = function()
{
	if(document.getElementById('swipe').checked)
	{
    	localStorage.setItem('stat', "true");
    }
	else
	{
            localStorage.setItem('stat', "false");
			CompareDates();
			showComic();
    }
}

setStatus = document.getElementById('lastdate');
setStatus.onclick = function()
{
	if(document.getElementById('lastdate').checked) 
	{
		localStorage.setItem('lastdate', "true");
	}
	else
	{
		localStorage.setItem('lastdate', "false");
	}
}


setStatus = document.getElementById('showfavs');
setStatus.onclick = function()
{
	var favs = JSON.parse(localStorage.getItem('favs'));
	if(document.getElementById('showfavs').checked)
	{
		localStorage.setItem('showfavs', "true");
		if(favs.indexOf(formattedComicDate) !== -1)
		{
		}
		else
		{
			currentselectedDate = new Date(favs[0]);	
		}
		document.getElementById('Current').innerHTML = 'Last'
	} 
	else
	{
		localStorage.setItem('showfavs', "false");
		document.getElementById('Current').innerHTML = 'Today'
	}

	CompareDates();
	showComic();

}

getStatus = localStorage.getItem('stat');
if (getStatus == "true")
{
	document.getElementById("swipe").checked = true;
}
else
{
	document.getElementById("swipe").checked = false;
}

getStatus = localStorage.getItem('showfavs');
if (getStatus == "true") 
{
	document.getElementById("showfavs").checked = true;
	document.getElementById('Current').innerHTML = 'Last'
}
else
{
	document.getElementById("showfavs").checked = false;
	document.getElementById('Current').innerHTML = 'Today'
}

getStatus = localStorage.getItem('lastdate');
if (getStatus == "true")
{
	document.getElementById("lastdate").checked = true;
}
else
{
	document.getElementById("lastdate").checked = false;
}	

	
	   